// HubSpot lead-capture client for stellreducation.org.
//
// HubSpot is the source of truth for every public lead route, so this module
// optimises for one thing: a captured lead must be *visible* in the portal
// without anyone knowing to search for it. That takes three writes, not one:
//
//   1. A **form submission** (Forms API). Only form submissions populate
//      "Recent Conversion" / "Recent Conversion Date" and put an entry on the
//      record timeline, and only they can trigger list membership and
//      workflows. A plain property PATCH is invisible in every one of those
//      places — which is why the first Nevada notify-me signup had to be found
//      by manual search.
//   2. A **note engagement**. Form submissions still do not set "Last Activity
//      Date" (`notes_last_updated`) — per HubSpot that field moves only for a
//      logged call, chat, meeting, note, email, SMS or WhatsApp. A note gives
//      us the Last Activity column and a human-readable audit line.
//   3. **Contact properties**, mapped to the portal's real event taxonomy
//      instead of stuffed into the shared free-text `message` field.
//
// Everything degrades: without form GUIDs we fall back to a property write;
// without a note scope we keep the properties; if the whole capture fails we
// dead-letter the payload and email an alert rather than losing it silently.
//
// Required env:
//   HUBSPOT_ACCESS_TOKEN          Service Key (preferred) or private-app token
//   HUBSPOT_PORTAL_ID             portal id (24379847) — needed for Forms API
//   HUBSPOT_FORM_*                per-route form GUIDs (see hubspot-fields.ts)
//
// HubSpot now steers single-account server integrations to Service Keys rather
// than legacy private apps. Both authenticate identically — `Authorization:
// Bearer <token>` — so this module is indifferent to which one is configured.
// Service Keys do not support webhooks, which we don't use against HubSpot.
//
// Scopes: crm.objects.contacts.read, crm.objects.contacts.write, forms.
// The note engagement in step 2 needs no scope of its own — per HubSpot's
// Notes API reference, POST /crm/v3/objects/notes is authorised by
// crm.objects.contacts.write. (A granular crm.objects.notes.write exists for
// OAuth apps but is not offered to Service Keys, and is not needed here.)

import { after } from 'next/server'
import { sendEmail } from '@/lib/email'
import { supabaseServer } from '@/lib/supabase'
import {
  HS,
  LEAD_SOURCES,
  formIdFor,
  type LeadSource,
} from '@/lib/hubspot-fields'

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
const CONTACT_EMAIL = process.env.CONTACT_EMAIL

const BASE = 'https://api.hubapi.com'
const FORMS_BASE = 'https://api.hsforms.com'

/** note → contact, HubSpot-defined association type. */
const ASSOCIATION_NOTE_TO_CONTACT = 202

/** Keep the append-only log bounded well inside HubSpot's text limits. */
const MAX_LOG_ENTRIES = 50

type Props = Record<string, string>

/* ── Low-level transport ─────────────────────────────────────────────────── */

async function hubspot(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

/* ── Contact read ────────────────────────────────────────────────────────── */

export interface ExistingContact {
  id: string
  properties: Props
}

/**
 * Look up a contact by email. Returns null when absent (404) or on error —
 * callers treat null as "new contact", which is the safe assumption: it means
 * we set a lifecycle stage and start a fresh activity log rather than
 * overwriting something we failed to read.
 */
export async function getContactByEmail(
  email: string,
  properties: string[] = [],
): Promise<ExistingContact | null> {
  if (!HUBSPOT_ACCESS_TOKEN) return null
  try {
    const query = properties.length ? `&properties=${properties.join(',')}` : ''
    const res = await hubspot(
      `/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email${query}`,
      'GET',
    )
    if (!res.ok) return null
    const json = (await res.json()) as { id: string; properties: Props }
    return { id: json.id, properties: json.properties ?? {} }
  } catch {
    return null
  }
}

/* ── Contact search ──────────────────────────────────────────────────────── */

export interface SearchedContact {
  id: string
  properties: Props
}

/**
 * Search contacts. Thin wrapper over the CRM search endpoint; callers build
 * their own filter groups so this stays general.
 *
 * Note the search index lags writes by a few seconds — a contact created or
 * deleted moments ago may not be reflected yet. Anything that must be exact
 * should read by id instead.
 */
export async function searchContacts(
  filterGroups: unknown[],
  properties: string[],
  limit = 100,
): Promise<SearchedContact[]> {
  if (!HUBSPOT_ACCESS_TOKEN) return []
  try {
    const res = await hubspot('/crm/v3/objects/contacts/search', 'POST', {
      filterGroups,
      properties,
      limit,
    })
    if (!res.ok) {
      console.error('[hubspot] Contact search failed', res.status, await res.text())
      return []
    }
    const json = (await res.json()) as { results?: SearchedContact[] }
    return json.results ?? []
  } catch (err) {
    console.error('[hubspot] Contact search error:', err)
    return []
  }
}

/* ── Lifecycle stage ─────────────────────────────────────────────────────── */

/**
 * Move a contact's lifecycle stage, including *backwards*.
 *
 * HubSpot silently refuses a backwards move: the PATCH returns 200 and the
 * value does not change. Verified against portal 24379847 — a contact at Lead
 * patched to `subscriber` stayed at Lead with no error anywhere. The documented
 * way round it is to clear the property first, then set it, which does stick.
 *
 * Two writes, so it is not free; call it only when the stage is actually wrong.
 * Returns false if either step fails, leaving the contact at whatever stage it
 * had — a wrong stage is recoverable, a blank one is worse.
 */
export async function setLifecycleStage(
  contactId: string,
  stage: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!HUBSPOT_ACCESS_TOKEN) return { ok: false, error: 'no-token' }
  try {
    const clear = await hubspot(`/crm/v3/objects/contacts/${contactId}`, 'PATCH', {
      properties: { [HS.lifecycleStage]: '' },
    })
    if (!clear.ok) {
      return { ok: false, error: `clear-failed:${clear.status}` }
    }

    const set = await hubspot(`/crm/v3/objects/contacts/${contactId}`, 'PATCH', {
      properties: { [HS.lifecycleStage]: stage },
    })
    if (!set.ok) {
      // The clear succeeded, so the contact is now blank. Say so loudly —
      // this is the one path that leaves a record worse than it started.
      console.error(
        `[hubspot] Lifecycle set failed after clear — contact ${contactId} left with no stage`,
        set.status,
      )
      return { ok: false, error: `set-failed:${set.status}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/* ── Contact write (fallback path) ───────────────────────────────────────── */

export interface UpsertContactInput {
  email: string
  firstName?: string
  lastName?: string
  /** Additional mapped properties. Never write machine data into `message`. */
  properties?: Props
  /** HubSpot lifecycle stage. Omit to leave an existing stage untouched. */
  lifecycleStage?: string
}

/**
 * Pull the offending property names out of a HubSpot 400. The body carries a
 * `message` whose value is itself escaped JSON, e.g.
 *
 *   "Property values were not valid: [{\"isValid\":false,
 *    \"message\":\"Property \\\"event_slug\\\" does not exist\",
 *    \"error\":\"PROPERTY_DOESNT_EXIST\",\"name\":\"event_slug\"}]"
 *
 * so we match `name` tolerantly of the escaping rather than parsing twice.
 */
export function rejectedPropertyNames(body: string): string[] {
  const names = new Set<string>()
  for (const match of body.matchAll(/\\?"name\\?"\s*:\s*\\?"([a-zA-Z0-9_]+)\\?"/g)) {
    names.add(match[1])
  }
  return [...names]
}

/**
 * Create or update a contact, keyed on email. Best-effort: returns `{ ok }` and
 * never throws.
 *
 * On a 400 it drops **only** the properties HubSpot actually named and retries,
 * rather than falling all the way back to identity fields. That distinction
 * matters: one property missing from the portal previously wiped the entire
 * patch, so a contact landed with a name and an email and none of the
 * segmentation the capture existed to record — silently, because the lead still
 * looked like it had been saved.
 */
export async function upsertContact(
  input: UpsertContactInput,
): Promise<{ ok: boolean; id?: string; status?: number; dropped?: string[] }> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    console.log('[hubspot] No HUBSPOT_ACCESS_TOKEN — would have upserted contact:', input.email)
    return { ok: false }
  }

  const core: Props = { [HS.email]: input.email }
  if (input.firstName) core[HS.firstName] = input.firstName
  if (input.lastName) core[HS.lastName] = input.lastName

  const full: Props = {
    ...core,
    ...(input.properties ?? {}),
    ...(input.lifecycleStage ? { [HS.lifecycleStage]: input.lifecycleStage } : {}),
  }

  const emailId = encodeURIComponent(input.email)

  async function write(props: Props): Promise<Response> {
    const updated = await hubspot(
      `/crm/v3/objects/contacts/${emailId}?idProperty=email`,
      'PATCH',
      { properties: props },
    )
    if (updated.status !== 404) return updated
    return hubspot('/crm/v3/objects/contacts', 'POST', { properties: props })
  }

  const dropped: string[] = []

  try {
    let res = await write(full)

    // Retry without exactly what HubSpot objected to, keeping the rest.
    if (res.status === 400) {
      const body = await res.text()
      const rejected = rejectedPropertyNames(body).filter((name) => name in full && name !== HS.email)

      if (rejected.length) {
        const pruned = { ...full }
        for (const name of rejected) delete pruned[name]
        dropped.push(...rejected)
        console.error(
          `[hubspot] Properties rejected by the portal — retrying without them: ${rejected.join(', ')}. ` +
            'If these are the Stellr fields, run: npx tsx scripts/hubspot-setup.ts',
        )
        res = await write(pruned)
      }

      // Only now give up on the extras entirely.
      if (res.status === 400) {
        console.error('[hubspot] Still rejected — falling back to identity fields:', await res.text())
        dropped.push(...Object.keys(full).filter((k) => !(k in core)))
        res = await write(core)
      }
    }

    if (!res.ok) {
      console.error('[hubspot] Contact upsert failed', res.status, await res.text())
      return { ok: false, status: res.status }
    }
    const json = (await res.json().catch(() => null)) as { id?: string } | null
    return { ok: true, id: json?.id, dropped: dropped.length ? [...new Set(dropped)] : undefined }
  } catch (err) {
    console.error('[hubspot] Contact upsert error:', err)
    return { ok: false }
  }
}

/* ── Form submission (primary path) ──────────────────────────────────────── */

export interface FormSubmissionContext {
  /** `hubspotutk` cookie — links the submission to the visitor's session. */
  hutk?: string
  pageUri?: string
  pageName?: string
}

/**
 * Read the `hubspotutk` cookie set by the tracking script. Passing it with a
 * submission ties the lead to the visitor's session so HubSpot can attribute an
 * original traffic source instead of filing everything under "Offline Sources".
 */
export function readHubspotCookie(req: Request): string | undefined {
  return req.headers.get('cookie')?.match(/(?:^|;\s*)hubspotutk=([^;]+)/)?.[1]
}

/**
 * Submit to a HubSpot form. This is what makes a lead visible: it stamps
 * Recent Conversion + Recent Conversion Date, writes a timeline entry, feeds
 * source attribution, and lets lists and workflows trigger on it.
 *
 * Two endpoints exist and the difference matters operationally:
 *
 *   /secure/submit/…  requires a token with the `forms` scope, higher rate limits
 *   /submit/…         requires no authentication whatsoever
 *
 * Verified against the live API: the unauthenticated path returns 404 for an
 * unknown form (i.e. it gets past auth), while the secure path 401s without
 * credentials. So the whole visibility fix works with no private app at all —
 * we prefer the secure endpoint when a token exists, and fall back rather than
 * losing conversion tracking to a missing scope.
 *
 * Fields not present on the form definition are rejected with a 400, so a
 * failure here falls back to a property write rather than dropping the lead.
 */
export async function submitForm(
  formId: string,
  fields: Props,
  context: FormSubmissionContext = {},
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!PORTAL_ID) return { ok: false, error: 'no-portal-id' }

  const body = {
    fields: Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([name, value]) => ({ objectTypeId: '0-1', name, value })),
    context: {
      ...(context.hutk ? { hutk: context.hutk } : {}),
      ...(context.pageUri ? { pageUri: context.pageUri } : {}),
      ...(context.pageName ? { pageName: context.pageName } : {}),
    },
  }

  // The public endpoint is what HubSpot's own embedded forms post to; the
  // secure one is the same operation with a token and higher rate limits.
  async function post(secure: boolean): Promise<Response> {
    const path = secure
      ? `/submissions/v3/integration/secure/submit/${PORTAL_ID}/${formId}`
      : `/submissions/v3/integration/submit/${PORTAL_ID}/${formId}`
    return fetch(`${FORMS_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secure ? { Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(body),
    })
  }

  try {
    let res = HUBSPOT_ACCESS_TOKEN ? await post(true) : await post(false)

    // A 401/403 means the token simply lacks the `forms` scope. Prefer
    // recording the conversion over failing the capture entirely.
    if (HUBSPOT_ACCESS_TOKEN && (res.status === 401 || res.status === 403)) {
      console.warn('[hubspot] Secure form submit rejected — using public endpoint')
      res = await post(false)
    }

    if (!res.ok) {
      const error = await res.text()
      console.error('[hubspot] Form submission failed', formId, res.status, error)
      return { ok: false, status: res.status, error }
    }
    return { ok: true }
  } catch (err) {
    console.error('[hubspot] Form submission error:', err)
    return { ok: false, error: String(err) }
  }
}

/* ── Note engagement ─────────────────────────────────────────────────────── */

/**
 * Log a note against a contact. This is the only write that moves "Last
 * Activity Date", and it gives the record a readable one-line history of what
 * the person actually asked for.
 */
export async function createNote(
  contactId: string,
  body: string,
): Promise<{ ok: boolean }> {
  if (!HUBSPOT_ACCESS_TOKEN) return { ok: false }
  try {
    const res = await hubspot('/crm/v3/objects/notes', 'POST', {
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: body,
      },
      associations: [
        {
          to: { id: contactId },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: ASSOCIATION_NOTE_TO_CONTACT,
            },
          ],
        },
      ],
    })
    if (!res.ok) {
      console.error('[hubspot] Note create failed', res.status, await res.text())
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('[hubspot] Note create error:', err)
    return { ok: false }
  }
}

/* ── Append-only activity log ────────────────────────────────────────────── */

/**
 * Append a line to the running log, preserving what's already there. The whole
 * point of this property is that repeat contact is additive — a person who
 * asks about Nevada and later downloads a white paper must keep both facts,
 * which is exactly what the shared `message` field failed to do.
 */
export function appendLogEntry(existing: string | undefined, entry: string): string {
  const lines = (existing ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  // Skip an entry identical to the one already at the end. Two things make
  // this worth doing: a double-clicked button shouldn't write the same fact
  // twice, and the append is a read-modify-write against a store with
  // read-after-write lag — so a rapid resubmit can read a stale log and drop
  // an entry. Collapsing consecutive duplicates makes that race a no-op
  // instead of silent data loss.
  if (lines[lines.length - 1] === entry) return lines.slice(-MAX_LOG_ENTRIES).join('\n')

  lines.push(entry)
  return lines.slice(-MAX_LOG_ENTRIES).join('\n')
}

/** `YYYY-MM-DD · <source> · <detail>` — stable, greppable, sorts naturally. */
export function logLine(source: LeadSource, detail: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `${date} · ${LEAD_SOURCES[source]} · ${detail}`
}

/**
 * Repair the activity log if our entry didn't survive a concurrent write.
 *
 * Appending is inherently read-modify-write, and HubSpot is read-after-write
 * lagged: two submissions close together can both read the same log, and the
 * second write then erases the first one's entry. Collapsing duplicates makes
 * that harmless when the entries match, but two *different* entries — someone
 * asking about Individual then Group, or two events in quick succession —
 * would still silently lose one.
 *
 * So verify rather than assume: re-read after the dust settles and, if our line
 * is missing, append it onto whatever is actually there now. This is
 * last-writer-wins with a repair pass, not a lock — it cannot make concurrent
 * appends atomic, but it recovers the entry that would otherwise vanish.
 *
 * Runs after the response (see `runAfterResponse`), so it costs the visitor
 * nothing.
 */
export async function reconcileLogEntry(email: string, entry: string): Promise<boolean> {
  if (!HUBSPOT_ACCESS_TOKEN) return false

  for (const delayMs of [500, 1500]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    const current = await getContactByEmail(email, [HS.notifyLog])
    if (!current) continue

    const log = current.properties?.[HS.notifyLog] ?? ''
    if (log.split('\n').some((line) => line.trim() === entry)) return true

    console.warn(`[hubspot] Activity log entry lost to a concurrent write — restoring: ${entry}`)
    await upsertContact({ email, properties: { [HS.notifyLog]: appendLogEntry(log, entry) } })
  }

  return false
}

/**
 * Schedule work to run once the response has been sent. Falls back to running
 * detached when there's no request context (scripts, tests), where `after`
 * throws.
 */
function runAfterResponse(task: () => Promise<unknown>): void {
  const safe = () =>
    task().catch((err) => console.error('[hubspot] Post-response task failed:', err))
  try {
    after(safe)
  } catch {
    void safe()
  }
}

/* ── Dead letter ─────────────────────────────────────────────────────────── */

/**
 * Persist a capture we could not deliver to HubSpot, and alert. Not a second
 * source of truth — a recovery net, so a dropped lead is a queue item someone
 * can replay rather than a person who quietly never hears from us.
 *
 * Only fires in environments that are actually configured for HubSpot; without
 * a token we're in local dev and the write is an expected no-op.
 */
async function deadLetter(input: LeadCaptureInput, reason: string): Promise<void> {
  if (!HUBSPOT_ACCESS_TOKEN) return

  const payload = {
    source: input.source,
    email: input.email,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    properties: input.properties ?? {},
    activity: input.activity,
    reason,
  }

  try {
    const { error } = await supabaseServer().from('lead_capture_failures').insert({
      email: input.email,
      source: input.source,
      reason,
      payload,
    })
    if (error) console.error('[hubspot] Dead-letter insert failed:', error.message)
  } catch (err) {
    console.error('[hubspot] Dead-letter unavailable:', err)
  }

  if (!CONTACT_EMAIL) return
  try {
    await sendEmail({
      to: CONTACT_EMAIL,
      subject: `[Stellr] Lead capture failed — ${LEAD_SOURCES[input.source]}`,
      html:
        `<p><strong>A lead did not reach HubSpot.</strong></p>` +
        `<p>Email: ${input.email}<br/>Route: ${LEAD_SOURCES[input.source]}<br/>Reason: ${reason}</p>` +
        `<p>${input.activity}</p>` +
        `<p>Queued in <code>lead_capture_failures</code> for replay.</p>`,
      text:
        `A lead did not reach HubSpot.\n\n` +
        `Email: ${input.email}\nRoute: ${LEAD_SOURCES[input.source]}\nReason: ${reason}\n\n` +
        `${input.activity}\n\nQueued in lead_capture_failures for replay.`,
    })
  } catch (err) {
    console.error('[hubspot] Dead-letter alert failed:', err)
  }
}

/* ── Orchestrator ────────────────────────────────────────────────────────── */

export interface LeadCaptureInput {
  email: string
  firstName?: string
  lastName?: string
  source: LeadSource
  /** Human-readable summary, used for the note body and any failure alert. */
  activity: string
  /** Mapped contact properties (event_*, registration_interest_type, …). */
  properties?: Props
  /** Applied only when the contact is new, so we never downgrade a customer. */
  lifecycleStage?: string
  /** Appended to the running activity log rather than overwriting it. */
  logEntry?: string
  context?: FormSubmissionContext
}

export interface LeadCaptureResult {
  ok: boolean
  /** Which write path succeeded — `form` is the one that yields visibility. */
  via: 'form' | 'contacts-api' | 'none'
  contactId?: string
  noteLogged: boolean
  warnings: string[]
}

/**
 * Capture a lead in HubSpot with full visibility. Order matters: read first so
 * the activity log appends and an existing contact's lifecycle stage is left
 * alone, then submit the form, then log the note.
 */
export async function captureLead(input: LeadCaptureInput): Promise<LeadCaptureResult> {
  const warnings: string[] = []

  const formId = formIdFor(input.source)

  // A form GUID alone is enough to record the conversion — the public submit
  // endpoint needs no credentials. Only give up when there is no route at all.
  if (!HUBSPOT_ACCESS_TOKEN && !formId) {
    console.log('[hubspot] No token and no form configured — would have captured:', input.email)
    return { ok: false, via: 'none', noteLogged: false, warnings: ['not-configured'] }
  }

  // ── 1. Read existing state ────────────────────────────────────────────────
  // Reading needs a token. Without one we cannot know what is already on the
  // record, which constrains what we are allowed to write below.
  const canRead = Boolean(HUBSPOT_ACCESS_TOKEN)
  const existing = canRead
    ? await getContactByEmail(input.email, [HS.notifyLog, HS.lifecycleStage])
    : null

  const properties: Props = {
    ...(input.properties ?? {}),
    [HS.leadSource]: LEAD_SOURCES[input.source],
  }

  // The activity log is append-only, which requires knowing the current value.
  // If we could not read it, writing would replace the history with a single
  // line — exactly the overwrite that lost data in the shared `message` field.
  // Skip it and say so rather than destroy what is there.
  if (input.logEntry) {
    if (canRead) {
      properties[HS.notifyLog] = appendLogEntry(existing?.properties?.[HS.notifyLog], input.logEntry)
    } else {
      warnings.push('log-skipped-unreadable')
    }
  }

  // Only stamp a lifecycle stage on a brand-new contact. Writing it on every
  // submission is what would push an existing member or customer back to
  // "lead" just because they asked about another event.
  const lifecycleStage = existing ? undefined : input.lifecycleStage

  // ── 2. Form submission (the visible path) ─────────────────────────────────
  let via: LeadCaptureResult['via'] = 'none'

  if (formId) {
    const form = await submitForm(
      formId,
      {
        [HS.email]: input.email,
        ...(input.firstName ? { [HS.firstName]: input.firstName } : {}),
        ...(input.lastName ? { [HS.lastName]: input.lastName } : {}),
        ...properties,
        // Deliberately no lifecyclestage. HubSpot owns lifecycle transitions
        // and won't let an API-created form declare that field at all, and a
        // submission naming a field the form doesn't have is a 400 — which
        // would cost us the conversion on exactly the first-touch capture that
        // needs it most. It is stamped separately in step 3b.
      },
      input.context,
    )
    if (form.ok) via = 'form'
    else warnings.push(`form-submit-failed:${form.status ?? form.error ?? 'unknown'}`)
  } else {
    warnings.push('no-form-configured')
  }

  // ── 3. Property write — fallback, or top-up when the form path is absent ──
  // Needs a token; with a form-only setup the form submission already carried
  // these same properties, so there is nothing lost by skipping it.
  let contactId = existing?.id
  if (via !== 'form' && HUBSPOT_ACCESS_TOKEN) {
    const upsert = await upsertContact({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      properties,
      lifecycleStage,
    })
    if (upsert.ok) {
      via = 'contacts-api'
      contactId = contactId ?? upsert.id
      // The lead landed, but not the segmentation — worth naming explicitly,
      // since a partially-written contact looks identical to a healthy one.
      if (upsert.dropped?.length) warnings.push(`properties-dropped:${upsert.dropped.join('|')}`)
    }
  }

  if (via === 'none') {
    await deadLetter(input, warnings.join('; ') || 'all-writes-failed')
    return { ok: false, via, noteLogged: false, warnings }
  }

  // ── 4. Note engagement — the only write that sets Last Activity Date ──────
  // A form submission creates the contact rather than returning it, and the
  // new record is not always readable on the next request. Retry briefly:
  // first-touch is precisely the case that needs the note most, since a brand
  // new contact has no other activity to surface it.
  if (!contactId && canRead) {
    for (const delayMs of [0, 400, 1200]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      contactId = (await getContactByEmail(input.email))?.id
      if (contactId) break
    }
  }

  // ── 3b. Lifecycle stage ───────────────────────────────────────────────────
  // The form path could not carry this (see step 2), so stamp it here. Only
  // when the form actually handled the capture — the property-write fallback
  // in step 3 already included it — and only for a contact that did not exist
  // before, so an established member is never pushed back to "subscriber".
  // Runs after the read-retry above so the freshly created contact is
  // addressable; a failure costs the stage, not the lead.
  if (via === 'form' && lifecycleStage && HUBSPOT_ACCESS_TOKEN) {
    const stamped = await upsertContact({ email: input.email, lifecycleStage })
    if (stamped.ok) contactId = contactId ?? stamped.id
    else warnings.push('lifecycle-stage-not-set')
  }

  let noteLogged = false
  if (!HUBSPOT_ACCESS_TOKEN) {
    // Form-only setup: the conversion and timeline entry landed, but Last
    // Activity Date needs an engagement, which needs a token.
    warnings.push('note-skipped-no-token')
  } else if (contactId) {
    noteLogged = (await createNote(contactId, input.activity)).ok
    if (!noteLogged) warnings.push('note-failed')
  } else {
    warnings.push('contact-id-unavailable')
  }

  // Verify the append survived. Only meaningful when we actually wrote one —
  // a form-only setup skips the log entirely because it cannot read first.
  if (input.logEntry && canRead) {
    const entry = input.logEntry
    runAfterResponse(() => reconcileLogEntry(input.email, entry))
  }

  return { ok: true, via, contactId, noteLogged, warnings }
}
