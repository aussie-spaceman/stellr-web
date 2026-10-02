/**
 * The parts of the e-sign e2e fixtures that need the app's own modules, run
 * under tsx (which resolves the `@/` aliases; Playwright's loader does not for
 * these files). Prints one JSON value on stdout. Used by ./esign.ts only.
 *
 *   tsx e2e/fixtures/esign-cli.ts issue-minor
 *   tsx e2e/fixtures/esign-cli.ts link <recipient row id>
 */

import { createClient } from '@supabase/supabase-js'

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

async function main() {
  // Issuing sends no email: the test mints each signer's link itself.
  delete process.env.RESEND_API_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`esign e2e fixtures only run against the dev project (${DEV_PROJECT_REF})`)
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
  const [command, arg] = process.argv.slice(2)

  if (command === 'link') {
    const { mintToken } = await import('../../lib/esign/native/tokens')
    const { data, error } = await db.from('docusign_envelope_recipients').select('token_version').eq('id', arg).single()
    if (error) throw new Error(error.message)
    return `/sign#${mintToken(arg, 'sign', data.token_version as number, 3600).token}`
  }

  if (command === 'issue-minor') {
    const { nativeProvider } = await import('../../lib/esign/providers/native')
    const stamp = Date.now().toString(36)
    const params = {
      eventTitle: 'E2E Signing Test',
      minorFirstName: 'Ezra',
      minorLastName: `E2E-${stamp}`,
      minorEmail: `e2e-student+${stamp}@example.test`,
      minorDateOfBirth: '2014-06-07',
      guardianName: 'Robin Guardian',
      guardianEmail: `e2e-guardian+${stamp}@example.test`,
      guardianPhone: '555 0142',
      relationship: 'Parent',
      schoolName: 'E2E Middle School',
      schoolState: 'CO',
    }
    const created = await nativeProvider.create({ db }, { type: 'minor', params } as never)
    const { data: row, error } = await db.from('docusign_envelopes').insert({
      participant_id: null,
      member_id: null,
      event_slug: 'e2e-signing',
      event_title: params.eventTitle,
      envelope_id: created.externalId,
      provider: 'native',
      envelope_type: 'minor',
      status: 'sent',
      signer_name: params.guardianName,
      signer_email: params.guardianEmail,
      minor_name: `${params.minorFirstName} ${params.minorLastName}`,
      signers_total: created.signerCount,
      signers_completed: 0,
      ...created.rowFields,
    }).select('id').single()
    if (error) throw new Error(`Issuing the test agreement failed: ${error.message}`)
    await created.afterRecord!(db, row.id as string)
    const { data: recipients } = await db
      .from('docusign_envelope_recipients')
      .select('id, role_name')
      .eq('envelope_row', row.id)
      .order('routing_order')
    return {
      rowId: row.id,
      signers: (recipients ?? []).map((r) => ({ id: r.id, role: r.role_name })),
      birthYear: '2014',
      guardianName: params.guardianName,
      studentName: `${params.minorFirstName} ${params.minorLastName}`,
    }
  }

  throw new Error('Commands: issue-minor | link <recipient id>')
}

main().then(
  (out) => { process.stdout.write(`${JSON.stringify(out)}\n`) },
  (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) },
)
