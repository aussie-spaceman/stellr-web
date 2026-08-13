#!/usr/bin/env npx tsx
/**
 * One-shot HubSpot portal setup for the stellreducation.org lead routes.
 *
 * Creates the contact properties and forms that lib/hubspot.ts writes to, and
 * repairs two pre-existing definitions that would otherwise reject valid data.
 * Idempotent: re-running skips anything that already exists, so it is safe to
 * run again after adding a route or an event year.
 *
 * Put the Service Key in .env.local (gitignored) as:
 *
 *   HUBSPOT_ACCESS_TOKEN=pat-na1-…
 *
 * then:
 *
 *   npx tsx scripts/hubspot-setup.ts --dry-run   # print the plan, change nothing
 *   npx tsx scripts/hubspot-setup.ts             # apply
 *
 * Requires HUBSPOT_ACCESS_TOKEN (and HUBSPOT_PORTAL_ID for the summary) in the
 * environment, carrying these four scopes:
 *
 *   crm.objects.contacts.read    crm.objects.contacts.write
 *   crm.schemas.contacts.write   forms
 *
 * Note creation needs no scope of its own — it is authorised by
 * crm.objects.contacts.write.
 *
 * Use a Service Key (Settings → Integrations → Service Keys, or Development →
 * Keys → Service Keys) — HubSpot now steers single-account integrations there
 * rather than to legacy private apps, and both send the same
 * `Authorization: Bearer` header. Note a key can only be granted scopes the
 * creating user already holds, so create it as a Super Admin.
 *
 * The credential currently in Vercel carries contacts.write only, so the
 * property and form calls will 403 until it is replaced or widened. The
 * preflight below reports exactly which scopes are missing before any writes.
 *
 * On success it prints the form GUIDs to add to Vercel as HUBSPOT_FORM_*.
 * Until those exist the site still captures leads, just via a property write
 * with no conversion attribution.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { LEAD_SOURCES, NOTIFY_STATUS, REGISTRATION_INTEREST, HS } from '../lib/hubspot-fields'

// Same convention as the other operational scripts: read .env.local so the
// Service Key lives in a gitignored file rather than in shell history.
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
const DRY_RUN = process.argv.includes('--dry-run')

const BASE = 'https://api.hubapi.com'
const GROUP_NAME = 'stellr_web'

if (!TOKEN) {
  console.error(
    'HUBSPOT_ACCESS_TOKEN is not set.\n' +
      `Add it to ${envPath} as HUBSPOT_ACCESS_TOKEN=<your Service Key>, then re-run.`,
  )
  process.exit(1)
}

// Catch the copy-paste-the-placeholder case before spending a round trip on a
// 401 that looks like a credential problem but isn't one.
if (/^(YOUR_SERVICE_KEY|<.*>|your_.*|xxx+)$/i.test(TOKEN)) {
  console.error(
    `HUBSPOT_ACCESS_TOKEN is still the placeholder "${TOKEN}".\n` +
      'Replace it with the real Service Key value from HubSpot → Settings → Integrations → Service Keys.',
  )
  process.exit(1)
}

/* ── Transport ───────────────────────────────────────────────────────────── */

async function api(
  path: string,
  method: 'GET' | 'POST' | 'PATCH',
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, json, text }
}

function opts(values: readonly string[]) {
  return values.map((value, i) => ({ label: value, value, displayOrder: i }))
}

/* ── Definitions ─────────────────────────────────────────────────────────── */

interface PropertyDef {
  name: string
  label: string
  description: string
  type: 'string' | 'enumeration' | 'date'
  fieldType: 'text' | 'textarea' | 'select' | 'checkbox' | 'date'
  options?: { label: string; value: string; displayOrder: number }[]
}

const PROPERTIES: PropertyDef[] = [
  {
    name: HS.eventSlug,
    label: 'Event Slug',
    description:
      'Sanity slug of the event this contact engaged with. The machine-readable join key between the website and HubSpot — use it for per-event active lists.',
    type: 'string',
    fieldType: 'text',
  },
  {
    name: HS.notifyRequestedDate,
    label: 'Notify Requested Date',
    description: 'When this contact last asked to be told that registration had opened.',
    type: 'date',
    fieldType: 'date',
  },
  {
    name: HS.notifyLog,
    label: 'Stellr Activity Log',
    description:
      'Append-only history of every website capture for this contact, one line per event. Written by the site — do not edit by hand.',
    type: 'string',
    fieldType: 'textarea',
  },
  {
    name: HS.notifyStatus,
    label: 'Notify Status',
    description: 'Where this contact sits in the notify-me follow-up cycle.',
    type: 'enumeration',
    fieldType: 'select',
    options: opts(Object.values(NOTIFY_STATUS)),
  },
  {
    name: HS.registrationInterest,
    label: 'Registration Interest',
    description:
      'Whether the contact reached for Individual or Group registration before it opened.',
    type: 'enumeration',
    fieldType: 'select',
    options: opts(Object.values(REGISTRATION_INTEREST)),
  },
  {
    name: HS.leadSource,
    label: 'Stellr Lead Source',
    description:
      'Which stellreducation.org route captured this contact. Durable even after Recent Conversion moves on.',
    type: 'enumeration',
    fieldType: 'select',
    options: opts(Object.values(LEAD_SOURCES)),
  },
]

/**
 * Fields every lead form carries, so any route can write the full picture.
 *
 * `lifecyclestage` is deliberately absent. HubSpot owns lifecycle transitions
 * and refuses to create a form that declares it as a field — the Forms API
 * rejects the whole definition with an opaque `"internal error"` (verified
 * field-by-field against portal 24379847: every other field here is accepted,
 * that one alone fails). `captureLead()` therefore stamps the stage with a
 * separate contact write; see the note in lib/hubspot.ts.
 */
const COMMON_FIELDS = [
  HS.email,
  HS.firstName,
  HS.lastName,
  HS.leadSource,
  HS.notifyLog,
]

const EVENT_FIELDS = [
  HS.eventSlug,
  HS.eventLocation,
  HS.eventYear,
  HS.eventTheme,
  HS.eventDemographic,
  HS.notifyStatus,
  HS.notifyRequestedDate,
  HS.registrationInterest,
]

const FORMS: { key: keyof typeof LEAD_SOURCES; name: string; fields: string[] }[] = [
  { key: 'event_notify', name: 'Website — Event Notify', fields: [...COMMON_FIELDS, ...EVENT_FIELDS] },
  { key: 'newsletter', name: 'Website — Newsletter Subscribe', fields: COMMON_FIELDS },
  { key: 'white_paper', name: 'Website — White Paper', fields: COMMON_FIELDS },
  { key: 'asset_request', name: 'Website — Asset Request', fields: COMMON_FIELDS },
  { key: 'scholarship', name: 'Website — Scholarship Application', fields: COMMON_FIELDS },
  { key: 'host_event', name: 'Website — Host An Event', fields: COMMON_FIELDS },
]

/* ── Preflight ───────────────────────────────────────────────────────────── */

/**
 * Probe one cheap read per scope we depend on, so a short-scoped credential is
 * reported up front as a list of exactly what to add — rather than as four
 * unrelated 403s halfway through a partial setup.
 *
 * 401 means the credential itself is wrong; 403 means it is valid but missing
 * that scope. Everything else (including 404) means the call got through.
 */
async function preflight(): Promise<boolean> {
  // These are READ probes. A read succeeding does not prove the matching write
  // is granted, and a read being denied does not prove the write is missing —
  // so this reports, it does not gate. Blocking on an unprovable inference is
  // worse than attempting the work: every step below is idempotent and
  // reports its own outcome, so a genuine scope failure surfaces there with
  // HubSpot's own error text attached.
  const checks: { label: string; path: string }[] = [
    { label: 'contacts (read)', path: '/crm/v3/objects/contacts?limit=1' },
    { label: 'properties (schema read)', path: '/crm/v3/properties/contacts' },
    { label: 'forms', path: '/marketing/v3/forms/?limit=1' },
  ]

  let unauthorized = false

  for (const check of checks) {
    const res = await api(check.path, 'GET')
    if (res.status === 401) {
      unauthorized = true
      console.error(`  ✗ ${check.label}: 401 rejected`)
    } else if (res.status === 403) {
      console.warn(`  ! ${check.label}: 403 — scope likely missing, will attempt anyway`)
    } else {
      console.log(`  ✓ ${check.label}`)
    }
  }

  // A 401 is the one unambiguous stop: the credential itself is not valid, so
  // nothing downstream can succeed.
  if (unauthorized) {
    console.error('\n  The credential was rejected. Check HUBSPOT_ACCESS_TOKEN is a current Service Key.')
    return false
  }
  return true
}

/* ── Steps ───────────────────────────────────────────────────────────────── */

/** Stock group that exists in every portal — the fallback if ours can't be made. */
const FALLBACK_GROUP = 'contactinformation'

const failures: string[] = []

/**
 * Returns the group name properties should be filed under. A grouping problem
 * must not cost us the properties themselves: which tab a field appears on is
 * cosmetic, whereas the field not existing is the outage.
 */
async function ensureGroup(): Promise<string> {
  const existing = await api(`/crm/v3/properties/contacts/groups/${GROUP_NAME}`, 'GET')
  if (existing.ok) {
    console.log(`  ✓ property group "${GROUP_NAME}" already exists`)
    return GROUP_NAME
  }
  if (DRY_RUN) {
    console.log(`  + would create property group "${GROUP_NAME}"`)
    return GROUP_NAME
  }
  const res = await api('/crm/v3/properties/contacts/groups', 'POST', {
    name: GROUP_NAME,
    label: 'Stellr Website',
  })
  if (res.ok) {
    console.log(`  + created property group "${GROUP_NAME}"`)
    return GROUP_NAME
  }
  console.warn(`  ! group create failed (${res.status}) — filing under "${FALLBACK_GROUP}" instead`)
  console.warn(`    ${res.text}`)
  return FALLBACK_GROUP
}

async function ensureProperties(groupName: string) {
  for (const def of PROPERTIES) {
    const existing = await api(`/crm/v3/properties/contacts/${def.name}`, 'GET')
    if (existing.ok) {
      console.log(`  ✓ ${def.name} already exists`)
      continue
    }
    if (DRY_RUN) {
      console.log(`  + would create ${def.name} (${def.fieldType})`)
      continue
    }
    const res = await api('/crm/v3/properties/contacts', 'POST', { ...def, groupName })
    if (res.ok) {
      console.log(`  + created ${def.name}`)
    } else {
      console.error(`  ✗ ${def.name} failed (${res.status}): ${res.text}`)
      failures.push(`property ${def.name} (${res.status})`)
    }
  }
}

/**
 * `event_year` is an enumeration that stops at 2027, so a 2028 event would be
 * silently rejected. Extend rather than replace, to preserve existing values.
 */
async function extendEventYears() {
  const current = await api(`/crm/v3/properties/contacts/${HS.eventYear}`, 'GET')
  if (!current.ok) {
    console.log(`  ! ${HS.eventYear} not found — skipping`)
    return
  }
  const have = new Set<string>((current.json?.options ?? []).map((o: any) => o.value))
  const wanted = ['2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030']
  const missing = wanted.filter((y) => !have.has(y))

  if (!missing.length) {
    console.log(`  ✓ ${HS.eventYear} already covers ${wanted.at(-1)}`)
    return
  }
  if (DRY_RUN) {
    console.log(`  + would add years: ${missing.join(', ')}`)
    return
  }
  const res = await api(`/crm/v3/properties/contacts/${HS.eventYear}`, 'PATCH', {
    options: opts([...wanted]),
  })
  console.log(res.ok ? `  + added years: ${missing.join(', ')}` : `  ✗ year extend failed: ${res.text}`)
}

/**
 * `ensureProperties` skips anything that already exists, so a *new option* on
 * an existing enumeration would never be applied. `Unsubscribed` was added to
 * NOTIFY_STATUS after the property was created, and the waitlist opt-out writes
 * it — without this the write is rejected and someone stays subscribed.
 */
async function ensureNotifyStatusOptions() {
  const current = await api(`/crm/v3/properties/contacts/${HS.notifyStatus}`, 'GET')
  if (!current.ok) {
    console.log(`  ! ${HS.notifyStatus} not found — skipping`)
    return
  }

  const have = new Set<string>((current.json?.options ?? []).map((o: any) => o.value))
  const wanted = Object.values(NOTIFY_STATUS)
  const missing = wanted.filter((v) => !have.has(v))

  if (!missing.length) {
    console.log(`  ✓ ${HS.notifyStatus} has all ${wanted.length} options`)
    return
  }
  if (DRY_RUN) {
    console.log(`  + would add notify statuses: ${missing.join(', ')}`)
    return
  }

  const res = await api(`/crm/v3/properties/contacts/${HS.notifyStatus}`, 'PATCH', {
    options: opts([...wanted]),
  })
  if (res.ok) console.log(`  + added notify statuses: ${missing.join(', ')}`)
  else {
    console.error(`  ✗ notify status options failed (${res.status}): ${res.text}`)
    failures.push(`notify status options (${res.status})`)
  }
}

/**
 * Sanity's grade level can be "Both", which a single-select cannot express
 * without discarding half the answer. Converting to a multi-checkbox keeps
 * existing single values intact and lets us write "Middle School;High School".
 */
async function convertDemographicToMultiSelect() {
  const current = await api(`/crm/v3/properties/contacts/${HS.eventDemographic}`, 'GET')
  if (!current.ok) {
    console.log(`  ! ${HS.eventDemographic} not found — skipping`)
    return
  }
  if (current.json?.fieldType === 'checkbox') {
    console.log(`  ✓ ${HS.eventDemographic} is already multi-select`)
    return
  }
  if (DRY_RUN) {
    console.log(`  + would convert ${HS.eventDemographic} select → checkbox (multi)`)
    return
  }
  const res = await api(`/crm/v3/properties/contacts/${HS.eventDemographic}`, 'PATCH', {
    fieldType: 'checkbox',
  })
  console.log(
    res.ok
      ? `  + converted ${HS.eventDemographic} to multi-select`
      : `  ✗ demographic convert failed: ${res.text}`,
  )
}

/**
 * The Forms API and the Properties API use *different* vocabularies for field
 * types — a property is `textarea`, the same field on a form is
 * `multi_line_text`. Rather than maintain a hand-written table that silently
 * rots when a property's type changes, derive the form type from whatever the
 * portal currently says the property is.
 */
/**
 * The exact set the Forms API accepts, as enumerated by HubSpot's own
 * validation error. Checked locally so a bad mapping fails here with a useful
 * message instead of as a 400 six times over.
 */
const VALID_FORM_FIELD_TYPES = new Set([
  'datepicker',
  'dropdown',
  'email',
  'file',
  'mobile_phone',
  'multi_line_text',
  'multiple_checkboxes',
  'number',
  'payment_link_radio',
  'phone',
  'radio',
  'single_checkbox',
  'single_line_text',
])

const FORM_FIELD_TYPE: Record<string, string> = {
  text: 'single_line_text',
  textarea: 'multi_line_text',
  select: 'dropdown',
  radio: 'radio',
  checkbox: 'multiple_checkboxes',
  booleancheckbox: 'single_checkbox',
  date: 'datepicker',
  number: 'number',
  file: 'file',
  phonenumber: 'phone',
}

interface PropertyMeta {
  fieldType: string
  options?: { label: string; value: string; displayOrder?: number }[]
}

/** name → its current definition, for deriving form fields. */
async function loadPropertyMeta(): Promise<Map<string, PropertyMeta>> {
  const res = await api('/crm/v3/properties/contacts', 'GET')
  const map = new Map<string, PropertyMeta>()
  if (!res.ok) {
    console.warn(`  ! could not read property definitions (${res.status}) — falling back to text fields`)
    return map
  }
  for (const p of res.json?.results ?? []) {
    map.set(p.name, { fieldType: p.fieldType, options: p.options })
  }
  return map
}

/**
 * `validation` is a required member of every form field — the API rejects the
 * whole request without it, naming only `[validation]`. The model is shared
 * across field types, so the email-oriented keys are simply inert on the
 * others.
 */
const NO_VALIDATION = { blockedEmailDomains: [], useDefaultBlockList: false }

function formFieldFor(name: string, meta: Map<string, PropertyMeta>) {
  // `email` has a dedicated form type with its own validation.
  if (name === HS.email) {
    return {
      objectTypeId: '0-1',
      name,
      fieldType: 'email',
      label: 'Email',
      required: true,
      hidden: false,
      validation: NO_VALIDATION,
    }
  }

  const property = meta.get(name)
  let fieldType = FORM_FIELD_TYPE[property?.fieldType ?? 'text'] ?? 'single_line_text'

  if (!VALID_FORM_FIELD_TYPES.has(fieldType)) {
    console.warn(
      `  ! "${name}" mapped to unsupported form type "${fieldType}" ` +
        `(property type "${property?.fieldType}") — using single_line_text`,
    )
    fieldType = 'single_line_text'
  }

  return {
    objectTypeId: '0-1',
    name,
    fieldType,
    label: name,
    required: false,
    hidden: true,
    validation: NO_VALIDATION,
    // Enumerated fields carry their choices; harmless elsewhere.
    ...(property?.options?.length
      ? {
          options: property.options.map((o, i) => ({
            label: o.label,
            value: o.value,
            displayOrder: o.displayOrder ?? i,
          })),
        }
      : {}),
  }
}

/**
 * Print the field shape of a form the portal already holds. HubSpot's create
 * schema for this endpoint is not publicly retrievable, so an existing form is
 * the only authoritative reference for what it will accept.
 */
async function dumpExampleFormShape() {
  const res = await api('/marketing/v3/forms/?limit=20', 'GET')
  const forms: any[] = res.json?.results ?? []
  const sample = forms.find((f) => f?.fieldGroups?.[0]?.fields?.[0])
  if (!sample) {
    console.error('    (no existing form available to compare against)')
    return
  }
  console.error(`\n    ── Field shape from existing form "${sample.name}" ──`)
  console.error(
    '    ' + JSON.stringify(sample.fieldGroups[0].fields[0], null, 2).split('\n').join('\n    '),
  )
  console.error('    ────────────────────────────────────────────────\n')
}

async function ensureForms(): Promise<Record<string, string>> {
  const guids: Record<string, string> = {}
  const meta = await loadPropertyMeta()

  const list = await api('/marketing/v3/forms/?limit=100', 'GET')
  if (!list.ok) {
    console.log(`  ✗ could not list forms (${list.status}) — is the "forms" scope granted? ${list.text}`)
    return guids
  }
  const byName = new Map<string, string>(
    (list.json?.results ?? []).map((f: any) => [f.name, f.id]),
  )

  for (const form of FORMS) {
    const existingId = byName.get(form.name)
    if (existingId) {
      guids[form.key] = existingId
      console.log(`  ✓ "${form.name}" already exists`)
      continue
    }
    if (DRY_RUN) {
      console.log(`  + would create "${form.name}" with ${form.fields.length} fields`)
      continue
    }

    // Non-marketable, API-only capture form: no styling, no follow-up email —
    // it exists so submissions register as conversions on the timeline.
    //
    // `createdAt`/`updatedAt` are documented as read-only response fields, but
    // this endpoint rejects a create without them ("Some required fields were
    // not set: [createdAt]"). Every form the portal returns carries both, so
    // send them rather than fight the validator; HubSpot overwrites the values
    // with its own server timestamps.
    const now = new Date().toISOString()
    const res = await api('/marketing/v3/forms/', 'POST', {
      name: form.name,
      formType: 'hubspot',
      createdAt: now,
      updatedAt: now,
      fieldGroups: form.fields
        // A field whose property doesn't exist would fail the whole form.
        .filter((name) => name === HS.email || meta.size === 0 || meta.has(name))
        .map((name) => ({
          groupType: 'default_group',
          richTextType: 'text',
          fields: [formFieldFor(name, meta)],
        })),
      configuration: {
        language: 'en',
        createNewContactForNewEmail: true,
        allowLinkToResetKnownValues: false,
        postSubmitAction: { type: 'thank_you', value: 'Thanks — you are on the list.' },
      },
      displayOptions: { renderRawHtml: true },
      legalConsentOptions: { type: 'none' },
    })

    if (res.ok && res.json?.id) {
      guids[form.key] = res.json.id
      console.log(`  + created "${form.name}" → ${res.json.id}`)
    } else {
      console.error(`  ✗ "${form.name}" failed (${res.status}): ${res.text}`)
      failures.push(`form ${form.name} (${res.status})`)
      // The published schema for this endpoint isn't retrievable, so on the
      // first failure show what a form the portal already accepts actually
      // looks like. That turns the next attempt into a correction rather than
      // another guess.
      if (failures.length === 1) await dumpExampleFormShape()
    }
  }
  return guids
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(
    `\nHubSpot setup — portal ${PORTAL_ID ?? '(unknown)'}${DRY_RUN ? '  [DRY RUN]' : ''}\n`,
  )

  console.log('Preflight — credential and reachability:')
  if (!(await preflight())) {
    console.error('\nAborted before making any changes.\n')
    process.exit(1)
  }

  console.log('\nProperty group:')
  const groupName = await ensureGroup()

  console.log('\nNew properties:')
  await ensureProperties(groupName)

  console.log('\nExisting taxonomy repairs:')
  await extendEventYears()
  await convertDemographicToMultiSelect()
  await ensureNotifyStatusOptions()

  console.log('\nForms:')
  const guids = await ensureForms()

  if (Object.keys(guids).length) {
    console.log('\n─── Add these to Vercel (Production + Preview) ───')
    for (const form of FORMS) {
      if (guids[form.key]) {
        console.log(`HUBSPOT_FORM_${form.key.toUpperCase()}=${guids[form.key]}`)
      }
    }
    console.log('─────────────────────────────────────────────────')
  }

  console.log('\nAlso ensure these are set:')
  console.log(`  HUBSPOT_PORTAL_ID=${PORTAL_ID ?? '24379847'}`)
  console.log(`  NEXT_PUBLIC_HUBSPOT_PORTAL_ID=${PORTAL_ID ?? '24379847'}   (tracking script)`)

  // Read the portal back rather than trusting our own write results. The whole
  // failure this script exists to end was a property that silently wasn't
  // there, so "did it work?" is answered by asking HubSpot, not by counting
  // 200s.
  if (!DRY_RUN) {
    console.log('\nVerification — reading the portal back:')
    const stillMissing: string[] = []
    for (const def of PROPERTIES) {
      const res = await api(`/crm/v3/properties/contacts/${def.name}`, 'GET')
      if (res.ok) console.log(`  ✓ ${def.name}`)
      else {
        console.error(`  ✗ ${def.name} is NOT in the portal`)
        stillMissing.push(def.name)
      }
    }
    if (stillMissing.length) failures.push(`properties still missing: ${stillMissing.join(', ')}`)

    const formList = await api('/marketing/v3/forms/?limit=100', 'GET')
    if (formList.ok) {
      const names = new Set<string>((formList.json?.results ?? []).map((f: any) => f.name))
      for (const form of FORMS) {
        if (names.has(form.name)) console.log(`  ✓ ${form.name}`)
        else console.error(`  ✗ ${form.name} is NOT in the portal`)
      }
    }
  }

  if (failures.length) {
    console.error('\n─── INCOMPLETE ───')
    for (const f of failures) console.error(`  ✗ ${f}`)
    console.error(
      '\nThe site will keep capturing leads, but anything above is dropped from the\n' +
        'contact record until it exists. Fix and re-run — this script is idempotent.\n',
    )
    process.exit(1)
  }

  console.log(DRY_RUN ? '\nDry run complete — nothing was changed.\n' : '\nAll steps completed.\n')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
