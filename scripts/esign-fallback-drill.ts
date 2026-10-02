/**
 * Fallback drill, on the DEV project only: does a new agreement go to Stellr
 * signing in each case where DocuSign can't take it, and to DocuSign when it
 * can? Runs the real routing and state code against the dev database and puts
 * the routing settings back afterwards.
 *
 *   npx tsx scripts/esign-fallback-drill.ts
 *
 * Cases:
 *   1. auto, usage at the cap                 → Stellr
 *   2. auto, "allowance spent" flag set        → Stellr
 *   3. auto, DocuSign refuses (allowance)      → flag recorded, Stellr, one alert
 *   4. auto, type not allowed to overflow      → the refusal reaches the caller
 *   5. docusign_only                           → DocuSign, whatever the usage
 *   6. membership                              → Stellr, always
 *
 * DocuSign's sandbox can't be made to return ENVELOPE_ALLOWANCE_EXCEEDED, so
 * case 3 and 4 make the adapter throw what lib/docusign turns that error into.
 * Nothing is created on DocuSign: case 5 stops at the routing decision. The
 * Stellr agreements are planned, not recorded, so no rows or emails result.
 * The admin alert in case 3 is real (in-app); its email is suppressed.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`Refusing: this only runs against the dev project (${DEV_PROJECT_REF})`)
  if (process.env.NEXT_PUBLIC_APP_ENV !== 'dev') throw new Error('Refusing: NEXT_PUBLIC_APP_ENV must be dev')
  delete process.env.RESEND_API_KEY

  const { createClient } = await import('@supabase/supabase-js')
  const { issueAgreement } = await import('../lib/esign/issue')
  const { docusignProvider } = await import('../lib/esign/providers/docusign')
  const { decideProvider, loadProviderState } = await import('../lib/esign/routing')
  const { AllowanceExhaustedError } = await import('../lib/esign/types')
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })

  const COLUMNS = 'mode, monthly_cap, reserve, overflow_types, overflow_allowlist, exhausted_until, exhausted_reason'
  const { data: saved, error } = await db.from('esign_provider_state').select(COLUMNS).eq('id', true).single()
  if (error) throw new Error(`Reading the routing settings failed: ${error.message}`)

  const set = async (patch: Record<string, unknown>) => {
    const { error: e } = await db.from('esign_provider_state').update(patch).eq('id', true)
    if (e) throw new Error(e.message)
  }
  const adult = {
    type: 'adult' as const,
    params: { eventTitle: 'Drill', firstName: 'Drill', lastName: 'Adult', email: 'drill-adult@example.test', phone: '555 0199', schoolName: 'Drill School', schoolState: 'CO' },
  }
  const membership = {
    type: 'membership' as const,
    params: { memberId: '00000000-0000-4000-8000-000000000000', firstName: 'Drill', lastName: 'Member', email: 'drill-member@example.test', dateOfBirth: '1990-01-01', phone: '555 0198' },
  }
  const realCreate = docusignProvider.create
  let docusignCalls = 0
  const refuse = async () => {
    docusignCalls++
    throw new AllowanceExhaustedError('docusign', 'ENVELOPE_ALLOWANCE_EXCEEDED (drill)')
  }

  const results: [string, boolean, string][] = []
  const check = (name: string, ok: boolean, detail: string) => results.push([name, ok, detail])

  try {
    // 1. Usage at the cap.
    await set({ mode: 'auto', monthly_cap: 0, reserve: 0, overflow_types: ['adult'], overflow_allowlist: [], exhausted_until: null, exhausted_reason: null })
    docusignProvider.create = refuse
    let created = await issueAgreement(db, adult as never)
    check('1. auto, usage at the cap', created.provider === 'native' && docusignCalls === 0, `→ ${created.provider}, DocuSign asked ${docusignCalls}×`)

    // 2. The "allowance spent" flag.
    await set({ monthly_cap: 10_000, exhausted_until: new Date(Date.now() + 86_400_000).toISOString(), exhausted_reason: 'drill' })
    created = await issueAgreement(db, adult as never)
    check('2. auto, allowance flag set', created.provider === 'native' && docusignCalls === 0, `→ ${created.provider}, DocuSign asked ${docusignCalls}×`)

    // 3. DocuSign refuses: recorded once, falls back, later ones skip DocuSign.
    await set({ exhausted_until: null, exhausted_reason: null })
    created = await issueAgreement(db, adult as never)
    const after = await loadProviderState(db)
    const flagged = !!after.exhaustedUntil && new Date(after.exhaustedUntil) > new Date()
    const second = await issueAgreement(db, adult as never)
    check(
      '3. auto, DocuSign refuses',
      created.provider === 'native' && flagged && second.provider === 'native' && docusignCalls === 1,
      `→ ${created.provider} then ${second.provider}; flag until ${after.exhaustedUntil?.slice(0, 10) ?? 'unset'}; DocuSign asked ${docusignCalls}×`,
    )

    // 4. Not allowed to overflow: the caller sees the refusal (and records a failure).
    await set({ overflow_types: [], exhausted_until: null, exhausted_reason: null })
    docusignCalls = 0
    const refused = await issueAgreement(db, adult as never).then(() => null, (e: unknown) => e)
    check('4. type not allowed to overflow', refused instanceof AllowanceExhaustedError, `→ ${refused instanceof Error ? refused.name : 'issued'}`)

    // 5. DocuSign only, even past the cap: decision only, nothing sent.
    await set({ mode: 'docusign_only', monthly_cap: 0, overflow_types: ['adult'] })
    const decision = decideProvider(await loadProviderState(db), {
      type: 'adult', signerEmails: ['drill-adult@example.test'], nativeAvailable: true, issuedThisPeriod: 999, issuedSinceSync: 0, now: new Date(),
    })
    check('5. docusign_only', decision.provider === 'docusign', `→ ${decision.provider} (${decision.reason})`)

    // 6. Membership never touches DocuSign, whatever the mode.
    docusignCalls = 0
    created = await issueAgreement(db, membership as never)
    check('6. membership', created.provider === 'native' && docusignCalls === 0, `→ ${created.provider}`)
  } finally {
    docusignProvider.create = realCreate
    await set(saved as Record<string, unknown>)
  }

  const { data: restored } = await db.from('esign_provider_state').select(COLUMNS).eq('id', true).single()
  const same = JSON.stringify(restored) === JSON.stringify(saved)
  for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(36)} ${detail}`)
  console.log(`${same ? 'PASS' : 'FAIL'}  routing settings restored`)
  if (!same || results.some(([, ok]) => !ok)) process.exit(1)
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
