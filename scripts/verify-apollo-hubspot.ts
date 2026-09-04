/**
 * Verification for the Apollo → HubSpot deal webhook.
 *
 * Two things about this integration cannot be settled from the public HubSpot
 * connector and have to be checked against the live portal:
 *
 *   1. **Scopes.** HUBSPOT_ACCESS_TOKEN was issued for the lead-capture routes
 *      and carries contacts + forms only. Deals are a different scope family,
 *      and without them every webhook event 403s — while still returning 200 to
 *      Apollo, because the route degrades rather than throwing. This prints the
 *      scope verdict plainly so that failure is never silent.
 *
 *   2. **Stage identity.** `dealstage` is a flat enumeration across *all*
 *      pipelines, so reading the property list cannot tell you which stages
 *      belong to the Participant Pipeline. The pipelines endpoint can, and this
 *      compares what it returns against the constants the route actually
 *      writes.
 *
 * Read-only: it creates no deal and modifies nothing.
 *
 * Prerequisites (.env.local): HUBSPOT_ACCESS_TOKEN with
 *   crm.objects.deals.read, crm.objects.deals.write
 *
 * `crm.pipelines.deals.read` is a private-app-era scope and is NOT offered in
 * the service-key catalogue, so the stage cross-check below is best-effort:
 * without it the integration still works, we just cannot prove from here which
 * pipeline the stage ids belong to.
 *
 * Run:
 *   npm run verify:apollo-hubspot
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// ESM hoists every static import above this call, so lib/hubspot-deals is
// imported dynamically below — it reads the token at module scope.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const token = process.env.HUBSPOT_ACCESS_TOKEN
const BASE = 'https://api.hubapi.com'

interface Stage {
  id: string
  label: string
  displayOrder: number
}
interface Pipeline {
  id: string
  label: string
  stages: Stage[]
}

async function main() {
  if (!token) {
    console.error('✗ HUBSPOT_ACCESS_TOKEN is not set in .env.local')
    process.exit(1)
  }

  const { PARTICIPANT_PIPELINE_ID, PARTICIPANT_STAGE, STAGE_FOR } = await import(
    '../lib/hubspot-deals'
  )

  const get = (p: string) =>
    fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}` } })

  /* ── 1. Scopes ─────────────────────────────────────────────────────────── */

  console.log('Scopes')
  const contactsRead = await get('/crm/v3/objects/contacts?limit=1')
  console.log(
    `  ${contactsRead.ok ? '✓' : '✗'} crm.objects.contacts.read ${contactsRead.status}` +
      (contactsRead.ok ? '' : '  ← the key changed; update .env.local AND Vercel'),
  )

  const dealsRead = await get('/crm/v3/objects/deals?limit=1')
  console.log(
    `  ${dealsRead.ok ? '✓' : '✗'} crm.objects.deals.read    ${dealsRead.status}`,
  )

  // Write probe that cannot create anything: PATCH a deal id that cannot exist.
  // 403 means the scope is absent; 4xx-but-not-403 means the call was
  // authorised and merely pointed at nothing.
  const writeProbe = await fetch(`${BASE}/crm/v3/objects/deals/0`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ properties: {} }),
  })
  const canWrite = writeProbe.status !== 403
  console.log(
    `  ${canWrite ? '✓' : '✗'} crm.objects.deals.write   ${writeProbe.status}` +
      (canWrite ? ' (probe only — nothing was created)' : ''),
  )

  if (!dealsRead.ok || !canWrite) {
    console.error(
      '\n✗ The token cannot read and write deals. In HubSpot →\n' +
        '  Development → Keys → Service Keys → Stellr-Web-Lead-Capture,\n' +
        '  add crm.objects.deals.read and crm.objects.deals.write, then re-run.\n' +
        '  Until then the webhook will accept events and write nothing.',
    )
    process.exit(1)
  }

  const pipelinesRes = await get('/crm/v3/pipelines/deals')
  if (!pipelinesRes.ok) {
    console.log(
      `\n⚠ Cannot read pipeline definitions (${pipelinesRes.status}).\n` +
        '  crm.pipelines.deals.read is not offered for service keys, so the\n' +
        '  stage-vs-pipeline cross-check is skipped. The integration will still\n' +
        '  work — but confirm by eye in HubSpot → Settings → Objects → Deals →\n' +
        '  Pipelines that the Participant Pipeline contains "Initial Interest"\n' +
        '  and "Initial Engagement", and that a test event lands in the right\n' +
        '  column.',
    )
    console.log('\n✓ Deal read/write scopes are in place.')
    return
  }

  /* ── 2. Stage identity ─────────────────────────────────────────────────── */

  const { results } = (await pipelinesRes.json()) as { results: Pipeline[] }

  console.log('\nPipelines')
  for (const p of results) {
    console.log(`  ${p.label}  (id=${p.id})`)
    for (const s of [...p.stages].sort((a, b) => a.displayOrder - b.displayOrder)) {
      console.log(`     ${s.label.padEnd(30)} ${s.id}`)
    }
  }

  const participant = results.find((p) => p.id === PARTICIPANT_PIPELINE_ID)
  console.log('\nChecks')
  if (!participant) {
    console.error(
      `  ✗ No pipeline with id ${PARTICIPANT_PIPELINE_ID}. Update ` +
        'PARTICIPANT_PIPELINE_ID in lib/hubspot-deals.ts.',
    )
    process.exit(1)
  }
  console.log(`  ✓ Participant Pipeline resolves to "${participant.label}"`)

  const live = new Map(participant.stages.map((s) => [s.id, s.label]))
  let ok = true

  for (const [engagement, stageId] of Object.entries(STAGE_FOR)) {
    const label = live.get(stageId)
    if (label) {
      console.log(`  ✓ ${engagement.padEnd(8)} → "${label}"`)
    } else {
      ok = false
      console.error(
        `  ✗ ${engagement.padEnd(8)} → stage ${stageId} is NOT in this pipeline`,
      )
    }
  }

  // The rank table only has to not contradict the portal; extra modelled
  // stages are harmless, stages pointing at the wrong pipeline are not.
  for (const [name, id] of Object.entries(PARTICIPANT_STAGE)) {
    if (!live.has(id)) {
      ok = false
      console.error(`  ✗ PARTICIPANT_STAGE.${name} (${id}) is not in this pipeline`)
    }
  }

  if (!ok) {
    console.error(
      '\n✗ Stage constants disagree with the portal. Correct them in ' +
        'lib/hubspot-deals.ts using the ids listed above.',
    )
    process.exit(1)
  }
  console.log('\n✓ All stage constants match the live portal.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
