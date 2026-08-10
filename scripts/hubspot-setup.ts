#!/usr/bin/env npx tsx
/**
 * One-shot HubSpot portal setup for the stellreducation.org lead routes.
 *
 * Creates the contact properties and forms that lib/hubspot.ts writes to, and
 * repairs two pre-existing definitions that would otherwise reject valid data.
 * Idempotent: re-running skips anything that already exists, so it is safe to
 * run again after adding a route or an event year.
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

import { LEAD_SOURCES, NOTIFY_STATUS, REGISTRATION_INTEREST, HS } from '../lib/hubspot-fields'

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const PORTAL_ID = process.env.HUBSPOT_PORTAL_ID ?? process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
const DRY_RUN = process.argv.includes('--dry-run')

const BASE = 'https://api.hubapi.com'
const GROUP_NAME = 'stellr_web'

if (!TOKEN) {
  console.error('HUBSPOT_ACCESS_TOKEN is not set. Export it and re-run.')
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

/** Fields every lead form carries, so any route can write the full picture. */
const COMMON_FIELDS = [
  HS.email,
  HS.firstName,
  HS.lastName,
  HS.leadSource,
  HS.notifyLog,
  HS.lifecycleStage,
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
  const checks: { scope: string; path: string }[] = [
    { scope: 'crm.objects.contacts.read', path: '/crm/v3/objects/contacts?limit=1' },
    { scope: 'crm.schemas.contacts.write', path: '/crm/v3/properties/contacts' },
    { scope: 'forms', path: '/marketing/v3/forms/?limit=1' },
  ]

  const missing: string[] = []
  let unauthorized = false

  for (const check of checks) {
    const res = await api(check.path, 'GET')
    if (res.status === 401) unauthorized = true
    else if (res.status === 403) missing.push(check.scope)
    else console.log(`  ✓ ${check.scope}`)
  }

  if (unauthorized) {
    console.error('\n  ✗ The credential was rejected (401). Check HUBSPOT_ACCESS_TOKEN.')
    return false
  }
  if (missing.length) {
    console.error(`\n  ✗ Missing scopes: ${missing.join(', ')}`)
    console.error('    Add them to the Service Key (or create a new one as a Super Admin) and re-run.')
    return false
  }

  // contacts.write can't be probed without writing, so it's only asserted.
  // It also covers note creation — there is no separate notes scope to add.
  console.log('  · contacts.write assumed — failures will surface per call')
  return true
}

/* ── Steps ───────────────────────────────────────────────────────────────── */

async function ensureGroup() {
  const existing = await api(`/crm/v3/properties/contacts/groups/${GROUP_NAME}`, 'GET')
  if (existing.ok) {
    console.log(`  ✓ property group "${GROUP_NAME}" already exists`)
    return
  }
  if (DRY_RUN) {
    console.log(`  + would create property group "${GROUP_NAME}"`)
    return
  }
  const res = await api('/crm/v3/properties/contacts/groups', 'POST', {
    name: GROUP_NAME,
    label: 'Stellr Website',
    displayOrder: -1,
  })
  console.log(res.ok ? `  + created property group "${GROUP_NAME}"` : `  ✗ group failed: ${res.text}`)
}

async function ensureProperties() {
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
    const res = await api('/crm/v3/properties/contacts', 'POST', {
      ...def,
      groupName: GROUP_NAME,
    })
    console.log(res.ok ? `  + created ${def.name}` : `  ✗ ${def.name} failed: ${res.text}`)
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

async function ensureForms(): Promise<Record<string, string>> {
  const guids: Record<string, string> = {}

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
    const res = await api('/marketing/v3/forms/', 'POST', {
      name: form.name,
      formType: 'hubspot',
      fieldGroups: form.fields.map((name) => ({
        groupType: 'default_group',
        richTextType: 'text',
        fields: [
          {
            objectTypeId: '0-1',
            name,
            fieldType: name === HS.notifyLog ? 'textarea' : 'single_line_text',
            label: name,
            required: name === HS.email,
            hidden: name !== HS.email,
          },
        ],
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
      console.log(`  ✗ "${form.name}" failed (${res.status}): ${res.text}`)
    }
  }
  return guids
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  console.log(
    `\nHubSpot setup — portal ${PORTAL_ID ?? '(unknown)'}${DRY_RUN ? '  [DRY RUN]' : ''}\n`,
  )

  console.log('Preflight — credential and scopes:')
  if (!(await preflight())) {
    console.error('\nAborted before making any changes.\n')
    process.exit(1)
  }

  console.log('\nProperty group:')
  await ensureGroup()

  console.log('\nNew properties:')
  await ensureProperties()

  console.log('\nExisting taxonomy repairs:')
  await extendEventYears()
  await convertDemographicToMultiSelect()

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
  console.log('')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exit(1)
})
