// Keeps HubSpot's event option lists in step with Sanity.
//
// Sanity is the source of truth for which events exist. The CRM's Event
// Location / Year / Theme / Demographic dropdowns (on contacts AND deals) used
// to be hand-kept, and drifted: the deal Location list offered North Carolina
// and Virtual years after either ran, lacked Texas and Nebraska, and stored
// "Iowa" behind the label "North Carolina [Raleigh]". This module derives the
// option set from the live Sanity events — with the same mappings lead capture
// writes (lib/hubspot-fields.ts) — and reconciles each property to it.
//
// Rules:
//   • Never delete history. Sanity only holds the current season, but HubSpot
//     is the only record of past ones (Texas [Houston] still tags 335
//     contacts). An option with no live event is HIDDEN — gone from the edit
//     dropdowns, still on every record that holds it — and unhidden if its
//     location comes back.
//   • The single exception is a "stale value": an option whose label is a value
//     we need but whose stored value is something else (the deal "Iowa" case).
//     HubSpot won't hold two options with one label, so it is dropped — only
//     after a live count proves no record holds it. In use, it is relabelled
//     "(legacy: …)" and hidden instead.
//   • An empty Sanity read never hides everything: a sync with no live events
//     refuses to write.
//
// Runs from the Sanity publish webhook (app/api/admin/sanity/event-sync), a
// daily cron (app/api/cron/hubspot-event-options) and by hand
// (npm run hubspot:sync-event-options). There is one HubSpot portal and no
// sandbox, so every caller decides whether to apply; nothing here assumes it.

import { hubspotFetch } from '@/lib/hubspot'
import {
  GRANT_DEMOGRAPHIC,
  HS,
  MULTI_SELECT_EVENT_PROPS,
  formIdFor,
  mapEventDemographic,
  mapEventLocation,
  mapEventTheme,
  mapEventYear,
  schoolYearFor,
  type EventLike,
} from '@/lib/hubspot-fields'
import { getEventsForHubspotSync } from '@/lib/sanity'

/* ── Types ───────────────────────────────────────────────────────────────── */

export interface HubSpotOption {
  label: string
  value: string
  displayOrder?: number
  hidden?: boolean
  description?: string
}

export type SyncObject = 'contacts' | 'deals'
export const SYNCED_OBJECTS: readonly SyncObject[] = ['contacts', 'deals']

export interface SyncEvent extends EventLike {
  slug?: { current?: string } | string | null
  status?: string | null
}

/** What one property's option list should look like. */
export interface OptionSpec {
  /** Values a live event produces — must exist and be visible, in this order. */
  live: string[]
  /** Values that stay visible without a live event (past years, College). */
  keepVisible: (value: string) => boolean
  /** Sort the visible options numerically (years) rather than by `live` order. */
  numeric?: boolean
}

export interface OptionChanges {
  added: string[]
  hidden: string[]
  unhidden: string[]
  /** Stale values removed — each proven unused by a live count. */
  dropped: string[]
  /** Stale values still in use, renamed "(legacy: …)" and hidden. */
  relabelled: string[]
  reordered: boolean
}

export interface OptionPlan {
  options: HubSpotOption[]
  changes: OptionChanges
}

/* ── Which events are live ───────────────────────────────────────────────── */

function slugOf(event: SyncEvent): string {
  return (typeof event.slug === 'string' ? event.slug : event.slug?.current) ?? event.title ?? '?'
}

/**
 * An event is live for the CRM from publication until its school year ends:
 * not cancelled, and in the current school year or later. The Colorado
 * challenge held on 3 Oct stays taggable until 1 Aug — its attendees are still
 * being followed up — and the 1 Aug rollover retires last year's options with
 * no manual step.
 */
export function liveEventsForCrm<T extends SyncEvent>(events: T[], now: Date): T[] {
  const current = schoolYearFor(now)
  return events.filter((event) => {
    if (event.status === 'cancelled') return false
    const year = mapEventYear(event, now)
    return year !== undefined && Number(year) >= current
  })
}

const THEME_ORDER = ['Space', 'Environmental', 'Life Sciences', 'Resources']
const DEMOGRAPHIC_ORDER = ['Middle School', 'High School']
/**
 * Never hidden, whatever the live events say: College is tagged by hand (no
 * Sanity event produces it), and the teacher-grant route writes its demographic
 * on every application regardless of the event calendar.
 */
const PINNED_DEMOGRAPHICS = new Set(['College', GRANT_DEMOGRAPHIC])

function byCanonicalOrder(order: string[]) {
  const rank = (v: string) => (order.includes(v) ? order.indexOf(v) : order.length)
  return (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b)
}

/**
 * The option spec for each managed property, from the live events. Fields an
 * event can't be mapped on are reported in `unmapped` — that event contributes
 * nothing to that property rather than a guessed value.
 */
export function desiredOptions(
  events: SyncEvent[],
  now: Date,
): { specs: Record<string, OptionSpec>; live: SyncEvent[]; unmapped: string[] } {
  const live = liveEventsForCrm(events, now)
  const unmapped: string[] = []

  // Location: in date order, campaigns (dateless) last, Fall before Spring.
  const locations = new Map<string, string>() // label → sort key
  const years = new Set<number>()
  const themes = new Set<string>()
  const demographics = new Set<string>()

  for (const event of live) {
    const slug = slugOf(event)

    const location = mapEventLocation(event)
    if (location) {
      const key = event.date ?? `9999-${event.season === 'spring' ? 2 : 1}`
      const prior = locations.get(location)
      if (!prior || key < prior) locations.set(location, key)
    } else unmapped.push(`${slug}: location`)

    const year = mapEventYear(event, now)
    if (year) years.add(Number(year))
    else unmapped.push(`${slug}: year`)

    const theme = mapEventTheme(event.type)
    if (theme) themes.add(theme)
    else unmapped.push(`${slug}: theme`)

    const demographic = mapEventDemographic(event)
    if (demographic) demographic.split(';').forEach((d) => demographics.add(d))
    else unmapped.push(`${slug}: demographic`)
  }

  const maxYear = years.size ? Math.max(...years) : schoolYearFor(now)

  const specs: Record<string, OptionSpec> = {
    [HS.eventLocation]: {
      live: [...locations.entries()]
        .sort(([la, ka], [lb, kb]) => ka.localeCompare(kb) || la.localeCompare(lb))
        .map(([label]) => label),
      keepVisible: () => false,
    },
    [HS.eventYear]: {
      live: [...years].sort((a, b) => a - b).map(String),
      // Past years stay visible — they are contact history people filter on.
      // Years beyond the last scheduled event are hidden until one exists.
      keepVisible: (value) => /^\d{4}$/.test(value) && Number(value) <= maxYear,
      numeric: true,
    },
    [HS.eventTheme]: {
      live: [...themes].sort(byCanonicalOrder(THEME_ORDER)),
      keepVisible: () => false,
    },
    [HS.eventDemographic]: {
      live: [...demographics].sort(byCanonicalOrder(DEMOGRAPHIC_ORDER)),
      keepVisible: (value) => PINNED_DEMOGRAPHICS.has(value),
    },
  }

  return { specs, live, unmapped }
}

/* ── Planning (pure) ─────────────────────────────────────────────────────── */

function inDisplayOrder(options: HubSpotOption[]): HubSpotOption[] {
  return options
    .map((option, index) => ({ option, index }))
    .sort(
      (a, b) =>
        (a.option.displayOrder ?? a.index) - (b.option.displayOrder ?? b.index) || a.index - b.index,
    )
    .map(({ option }) => option)
}

/**
 * Options whose label is a value the spec needs but whose stored value differs.
 * The caller counts the records holding each before planning.
 */
export function findStaleValues(existing: HubSpotOption[], spec: OptionSpec): string[] {
  const values = new Set(existing.map((o) => o.value))
  return existing
    .filter((o) => o.value !== o.label && spec.live.includes(o.label) && !values.has(o.label))
    .map((o) => o.value)
}

/**
 * The option list a property should have, or null when it already has it.
 *
 * `staleUsage` maps each stale value to the number of records holding it. A
 * stale value with no count (the count failed) is treated as in use — the
 * safe direction: a relabelled, hidden option costs nothing; a dropped one
 * orphans every record that held it.
 */
export function planOptions(
  existing: HubSpotOption[],
  spec: OptionSpec,
  staleUsage: Record<string, number> = {},
): OptionPlan | null {
  const live = new Set(spec.live)
  const stale = new Set(findStaleValues(existing, spec))
  const changes: OptionChanges = {
    added: [],
    hidden: [],
    unhidden: [],
    dropped: [],
    relabelled: [],
    reordered: false,
  }

  const current = inDisplayOrder(existing)
  const kept: HubSpotOption[] = []

  for (const option of current) {
    if (stale.has(option.value)) {
      if (staleUsage[option.value] === 0) {
        changes.dropped.push(option.value)
        continue
      }
      changes.relabelled.push(option.value)
      if (!option.hidden) changes.hidden.push(option.value)
      kept.push({ ...option, label: `${option.label} (legacy: ${option.value})`, hidden: true })
      continue
    }

    const visible = live.has(option.value) || spec.keepVisible(option.value)
    if (visible && option.hidden) changes.unhidden.push(option.value)
    if (!visible && !option.hidden) changes.hidden.push(option.value)
    kept.push({ ...option, hidden: !visible })
  }

  const have = new Set(kept.map((o) => o.value))
  for (const value of spec.live) {
    if (have.has(value)) continue
    changes.added.push(value)
    kept.push({ label: value, value, hidden: false })
  }

  // Visible options first — in spec order (numeric for years), anything kept
  // visible without a live event after the live ones — then hidden options in
  // the order they already had.
  const liveRank = (v: string) => (live.has(v) ? spec.live.indexOf(v) : spec.live.length)
  const visible = kept
    .filter((o) => !o.hidden)
    .map((option, index) => ({ option, index }))
    .sort((a, b) =>
      spec.numeric
        ? Number(a.option.value) - Number(b.option.value)
        : liveRank(a.option.value) - liveRank(b.option.value) || a.index - b.index,
    )
    .map(({ option }) => option)
  const ordered = [...visible, ...kept.filter((o) => o.hidden)].map((option, displayOrder) => ({
    ...option,
    displayOrder,
  }))

  // Reordered = the options that were already there now sit in a different
  // sequence (additions and drops are reported on their own).
  const sequence = (list: HubSpotOption[]) =>
    list
      .map((o) => o.value)
      .filter((v) => !changes.added.includes(v) && !changes.dropped.includes(v))
      .join('\n')
  changes.reordered = sequence(current) !== sequence(ordered)

  const changed =
    changes.added.length > 0 ||
    changes.hidden.length > 0 ||
    changes.unhidden.length > 0 ||
    changes.dropped.length > 0 ||
    changes.relabelled.length > 0 ||
    changes.reordered
  return changed ? { options: ordered, changes } : null
}

/* ── HubSpot I/O ─────────────────────────────────────────────────────────── */

const MANAGED_NOTE =
  'Options follow Sanity: managed by the website from the live event list. ' +
  'Edit events in Sanity — options added here are hidden on the next sync.'

function managedDescription(current?: string): string {
  const text = (current ?? '').trim()
  if (text.includes('Options follow Sanity')) return text
  return text ? `${text} ${MANAGED_NOTE}` : MANAGED_NOTE
}

async function readJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null
}

/** Records on `object` whose multi-select `property` holds `value`. */
async function countRecordsWith(
  object: SyncObject,
  property: string,
  value: string,
): Promise<number | undefined> {
  const res = await hubspotFetch(`/crm/v3/objects/${object}/search`, 'POST', {
    filterGroups: [{ filters: [{ propertyName: property, operator: 'IN', values: [value] }] }],
    limit: 1,
  })
  if (!res.ok) return undefined
  const json = await readJson<{ total?: number }>(res)
  return typeof json?.total === 'number' ? json.total : undefined
}

export interface PropertySyncResult {
  object: SyncObject
  property: string
  status: 'unchanged' | 'updated' | 'would-update' | 'failed'
  changes?: OptionChanges
  error?: string
}

export interface FormSyncResult {
  status: 'unchanged' | 'updated' | 'would-update' | 'skipped' | 'failed'
  fields?: string[]
  error?: string
}

export interface EventOptionsSyncResult {
  ok: boolean
  applied: boolean
  liveEvents: string[]
  unmapped: string[]
  properties: PropertySyncResult[]
  form: FormSyncResult
  /** Set when the sync refused to run at all. */
  refused?: string
}

/**
 * Reconcile the managed event properties on contacts and deals, then the
 * Event Notify form's copies of their option lists. Each property is
 * independent: one failing (a 403 before the deals schema scope is granted)
 * is recorded and the rest still run.
 */
export async function syncEventOptions(opts: {
  apply: boolean
  now?: Date
  /** Injected for tests; otherwise read live from Sanity. */
  events?: SyncEvent[]
}): Promise<EventOptionsSyncResult> {
  const now = opts.now ?? new Date()
  const events = opts.events ?? ((await getEventsForHubspotSync()) as SyncEvent[] | null)

  const empty = (refused: string): EventOptionsSyncResult => ({
    ok: false,
    applied: false,
    liveEvents: [],
    unmapped: [],
    properties: [],
    form: { status: 'skipped' },
    refused,
  })

  if (!process.env.HUBSPOT_ACCESS_TOKEN) return empty('HUBSPOT_ACCESS_TOKEN not set')
  if (!events) return empty('Sanity is not configured or the read failed')

  const { specs, live, unmapped } = desiredOptions(events, now)
  // An outage or an emptied dataset must not read as "no events" and hide
  // every option in the portal.
  if (live.length === 0) return { ...empty('No live events in Sanity — refusing to hide every option'), unmapped }

  const properties: PropertySyncResult[] = []
  /** Contact options after the sync, for the form refresh. */
  const contactOptions = new Map<string, HubSpotOption[]>()

  for (const object of SYNCED_OBJECTS) {
    for (const property of MULTI_SELECT_EVENT_PROPS) {
      const spec = specs[property]
      const res = await hubspotFetch(`/crm/v3/properties/${object}/${property}`, 'GET')
      if (!res.ok) {
        properties.push({ object, property, status: 'failed', error: `read ${res.status}` })
        continue
      }
      const definition = await readJson<{ options?: HubSpotOption[]; description?: string }>(res)
      const existing = definition?.options ?? []

      const staleUsage: Record<string, number> = {}
      for (const value of findStaleValues(existing, spec)) {
        const count = await countRecordsWith(object, property, value)
        if (count !== undefined) staleUsage[value] = count
      }

      const plan = planOptions(existing, spec, staleUsage)
      const description = managedDescription(definition?.description)
      const descriptionChanged = description !== (definition?.description ?? '').trim()

      if (!plan && !descriptionChanged) {
        properties.push({ object, property, status: 'unchanged' })
        if (object === 'contacts') contactOptions.set(property, existing)
        continue
      }

      const options = plan?.options ?? existing
      if (!opts.apply) {
        properties.push({ object, property, status: 'would-update', changes: plan?.changes })
        if (object === 'contacts') contactOptions.set(property, options)
        continue
      }

      const patch = await hubspotFetch(`/crm/v3/properties/${object}/${property}`, 'PATCH', {
        options: options.map(({ label, value, displayOrder, hidden, description: d }) => ({
          label,
          value,
          displayOrder,
          hidden: Boolean(hidden),
          ...(d ? { description: d } : {}),
        })),
        description,
      })
      if (patch.ok) {
        properties.push({ object, property, status: 'updated', changes: plan?.changes })
        if (object === 'contacts') contactOptions.set(property, options)
      } else {
        const text = await patch.text().catch(() => '')
        properties.push({
          object,
          property,
          status: 'failed',
          changes: plan?.changes,
          error: `write ${patch.status}: ${text.slice(0, 300)}`,
        })
        if (object === 'contacts') contactOptions.set(property, existing)
      }
    }
  }

  const form = await syncNotifyForm(opts.apply, contactOptions)
  const ok = properties.every((p) => p.status !== 'failed') && form.status !== 'failed'

  return {
    ok,
    applied: opts.apply,
    liveEvents: live.map(slugOf),
    unmapped,
    properties,
    form,
  }
}

/* ── Event Notify form ───────────────────────────────────────────────────── */

interface FormField {
  name: string
  fieldType?: string
  objectTypeId?: string
  options?: { label: string; value: string; displayOrder?: number; description?: string }[]
  [key: string]: unknown
}

interface FormDefinition {
  fieldGroups?: { fields?: FormField[]; [key: string]: unknown }[]
}

const CONTACT_OBJECT_TYPE = '0-1'
/** Option-list fields. A boolean checkbox also carries options, with its own labels. */
const ENUM_FIELD_TYPES = new Set(['dropdown', 'multiple_checkboxes', 'radio'])

/**
 * HubSpot copies a property's options into a form field when the field is
 * created, and never updates the copy — the Event Notify form still lacks
 * `Unsubscribed`, added to its property weeks later. Every enumeration field
 * on the form is refreshed from its property, hidden options included: the
 * fields are hidden, and a submission carries a contact's merged history, so
 * any value the property holds must be submittable.
 */
async function syncNotifyForm(
  apply: boolean,
  known: Map<string, HubSpotOption[]>,
): Promise<FormSyncResult> {
  const formId = formIdFor('event_notify')
  if (!formId) return { status: 'skipped', error: 'HUBSPOT_FORM_EVENT_NOTIFY not set' }

  const res = await hubspotFetch(`/marketing/v3/forms/${formId}`, 'GET')
  if (!res.ok) return { status: 'failed', error: `read ${res.status}` }
  const form = await readJson<FormDefinition>(res)
  if (!form?.fieldGroups) return { status: 'failed', error: 'form has no fieldGroups' }

  const changed: string[] = []
  for (const group of form.fieldGroups) {
    for (const field of group.fields ?? []) {
      if (!Array.isArray(field.options)) continue
      if (!ENUM_FIELD_TYPES.has(String(field.fieldType))) continue
      if (field.objectTypeId && field.objectTypeId !== CONTACT_OBJECT_TYPE) continue

      let source = known.get(field.name)
      if (!source) {
        const prop = await hubspotFetch(`/crm/v3/properties/contacts/${field.name}`, 'GET')
        if (!prop.ok) continue
        source = (await readJson<{ options?: HubSpotOption[] }>(prop))?.options ?? []
      }
      const next = inDisplayOrder(source).map((o, displayOrder) => ({
        label: o.label,
        value: o.value,
        displayOrder,
        ...(o.description ? { description: o.description } : {}),
      }))
      const same =
        next.length === field.options.length &&
        next.every((o, i) => o.value === field.options![i].value && o.label === field.options![i].label)
      if (same) continue
      field.options = next
      changed.push(field.name)
    }
  }

  if (!changed.length) return { status: 'unchanged' }
  if (!apply) return { status: 'would-update', fields: changed }

  const patch = await hubspotFetch(`/marketing/v3/forms/${formId}`, 'PATCH', {
    fieldGroups: form.fieldGroups,
  })
  if (!patch.ok) {
    const text = await patch.text().catch(() => '')
    return { status: 'failed', fields: changed, error: `write ${patch.status}: ${text.slice(0, 300)}` }
  }
  return { status: 'updated', fields: changed }
}
