/**
 * The parts of the age-band e2e fixtures that need the app's own modules, run
 * under tsx (which resolves the `@/` aliases; Playwright's loader does not).
 * Prints one JSON value on stdout. Used by ./age-bands.ts only.
 *
 *   tsx e2e/fixtures/age-bands-cli.ts issue-consent <json>
 *   tsx e2e/fixtures/age-bands-cli.ts link <recipient row id>
 *   tsx e2e/fixtures/age-bands-cli.ts purge <member id>...
 *   tsx e2e/fixtures/age-bands-cli.ts clerk-user <clerk user id>
 *   tsx e2e/fixtures/age-bands-cli.ts remove <email> [<clerk user id>]
 *
 * Every command refuses any database but the dev project or a stack on this
 * machine (assertE2eSupabase), and `remove` refuses any address but the
 * generated ones this suite makes (STRANGER_EMAIL).
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClerkClient } from '@clerk/backend'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'

/** The only addresses this suite creates, and so the only ones `remove` touches. */
const STRANGER_EMAIL = /^e2e-ageband-[a-z0-9-]+\+clerk_test@example\.com$/

// The deletion code (lib/deletion/execute, which the purge and the clean-up
// run) reaches modules marked `server-only`, a package that throws outside a
// React Server bundle. Stub it with an empty module, as vitest.config.mts does,
// so the app's own deletion runs here rather than a copy of it.
const requireHere = createRequire(join(process.cwd(), 'package.json'))
const serverOnly = requireHere.resolve('server-only')
requireHere.cache[serverOnly] = { id: serverOnly, filename: serverOnly, loaded: true, exports: {} } as never

function clerk() {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) throw new Error('CLERK_SECRET_KEY is not set')
  return createClerkClient({ secretKey })
}

async function clerkUserExists(id: string): Promise<boolean> {
  try {
    await clerk().users.getUser(id)
    return true
  } catch (err) {
    if ((err as { status?: number }).status === 404) return false
    throw err
  }
}

/** Everything an agreement left behind: audit trail, stored files, rows (as ./esign.ts removeAgreement). */
async function removeAgreement(db: SupabaseClient, rowId: string): Promise<void> {
  const { data: row } = await db.from('agreements').select('signed_pdf_path, certificate_path').eq('id', rowId).maybeSingle()
  const paths = [row?.signed_pdf_path, row?.certificate_path].filter(Boolean) as string[]
  if (paths.length) await db.storage.from('signed-agreements').remove(paths)
  await db.rpc('esign_purge_audit', { p_envelope: rowId })
  await db.from('esign_access_log').delete().eq('envelope_row', rowId)
  await db.from('agreement_recipients').delete().eq('envelope_row', rowId)
  await db.from('agreements').delete().eq('id', rowId)
}

async function main() {
  // Nothing here sends mail: the test mints each signer's link itself.
  delete process.env.RESEND_API_KEY
  const url = assertE2eSupabase()
  const db = createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
  const [command, ...args] = process.argv.slice(2)

  // The guardian's consent form for a self-registered minor, on Stellr signing:
  // the Student / Minor agreement the membership path issues (event slug
  // 'membership', guardian first, then the student). Issued here rather than by
  // the app because the dev database routes new agreements to DocuSign, whose
  // pages a test cannot sign, and CI holds no DocuSign credentials.
  if (command === 'issue-consent') {
    const input = JSON.parse(args[0]) as {
      memberId: string; dateOfBirth: string; firstName: string; studentEmail: string
      guardianName: string; guardianEmail: string; grade: string
    }
    const { nativeProvider } = await import('../../lib/esign/providers/native')
    const { MEMBERSHIP_SLUG, MEMBERSHIP_TITLE } = await import('../../lib/membership-agreement')
    const params = {
      eventTitle: MEMBERSHIP_TITLE,
      minorFirstName: input.firstName,
      minorLastName: 'Stranger',
      minorEmail: input.studentEmail,
      minorDateOfBirth: input.dateOfBirth,
      guardianName: input.guardianName,
      guardianEmail: input.guardianEmail,
      guardianPhone: '555 0142',
      relationship: 'Parent',
      // The form asks the guardian for both; prefilled as ./esign-cli.ts does.
      schoolName: 'E2E High School',
      schoolState: 'CO',
      grade: input.grade,
    }
    const created = await nativeProvider.create({ db }, { type: 'minor', params } as never)
    const { data: row, error } = await db.from('agreements').insert({
      participant_id: null,
      member_id: input.memberId,
      event_slug: MEMBERSHIP_SLUG,
      event_title: MEMBERSHIP_TITLE,
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
    if (error) throw new Error(`Issuing the consent form failed: ${error.message}`)
    await created.afterRecord!(db, row.id as string)
    const { data: recipients } = await db
      .from('agreement_recipients')
      .select('id, role_name')
      .eq('envelope_row', row.id)
      .order('routing_order')
    return {
      rowId: row.id,
      signers: (recipients ?? []).map((r) => ({ id: r.id, role: r.role_name })),
      birthYear: input.dateOfBirth.slice(0, 4),
      guardianName: params.guardianName,
      studentName: `${params.minorFirstName} ${params.minorLastName}`,
    }
  }

  if (command === 'link') {
    const { mintToken } = await import('../../lib/esign/native/tokens')
    const { data, error } = await db.from('agreement_recipients').select('token_version').eq('id', args[0]).single()
    if (error) throw new Error(error.message)
    return `/sign#${mintToken(args[0], 'sign', data.token_version as number, 3600).token}`
  }

  // The 30-day purge (lib/pending-consent purgeUnconsentedAccounts), run as the
  // daily cron runs it, with the real deletion (the deletion registry's
  // pending_consent_member: rows, consent forms and the Clerk login). The cron
  // route itself declines outside production (app/api/cron/membership-expiry,
  // "Steps 1 to 3 ... production only, with no exception"), so the e2e calls the
  // function the route calls. Scoped to the accounts this test made: the dev
  // database is shared, and another run's account is never this run's to delete.
  if (command === 'purge') {
    const ours = new Set(args)
    if (!ours.size) throw new Error('purge needs the member ids this test created')
    const { purgeUnconsentedAccounts } = await import('../../lib/pending-consent')
    const { executeDeletion } = await import('../../lib/deletion/execute')
    const deleted: string[] = []
    const result = await purgeUnconsentedAccounts(db, {
      limit: 200,
      deleteMember: async (memberId) => {
        if (!ours.has(memberId)) return
        await executeDeletion('pending_consent_member', memberId, { mode: 'hard', deletedBy: null })
        deleted.push(memberId)
      },
    })
    const mine = (ids: string[]) => ids.filter((id) => ours.has(id))
    return {
      purged: deleted,
      cleared: mine(result.cleared),
      heldGuardianSigned: mine(result.heldGuardianSigned),
      heldAdultRoute: mine(result.heldAdultRoute),
      errors: result.errors.filter((e) => ours.has(e.memberId)),
    }
  }

  if (command === 'clerk-user') return clerkUserExists(args[0])

  // Clean-up: every member row for the address (the app's onboarding, and the
  // Clerk webhook on the hosted dev deployment, can each make one), its consent
  // forms and pending request, the deletion snapshot, and the Clerk login.
  if (command === 'remove') {
    const [email, clerkUserId] = args
    if (!STRANGER_EMAIL.test(email ?? '')) throw new Error('remove only takes an address this suite generated')
    const { data: members, error } = await db.from('members').select('id, clerk_user_id').eq('email', email)
    if (error) throw new Error(error.message)
    const rows = (members ?? []) as Array<{ id: string; clerk_user_id: string | null }>
    if (clerkUserId) {
      const { data: byClerk } = await db.from('members').select('id, clerk_user_id').eq('clerk_user_id', clerkUserId)
      for (const r of (byClerk ?? []) as typeof rows) if (!rows.some((x) => x.id === r.id)) rows.push(r)
    }
    const { executeDeletion } = await import('../../lib/deletion/execute')
    for (const m of rows) {
      const { data: agreements } = await db.from('agreements').select('id').eq('member_id', m.id)
      for (const a of (agreements ?? []) as Array<{ id: string }>) await removeAgreement(db, a.id)
      await db.from('member_pending_consent').delete().eq('member_id', m.id)
      await executeDeletion('member', m.id, { mode: 'hard', deletedBy: null })
      await db.from('deletion_archive').delete().eq('entity_id', m.id)
    }
    const logins = new Set([clerkUserId, ...rows.map((r) => r.clerk_user_id)].filter(Boolean) as string[])
    for (const id of logins) if (await clerkUserExists(id)) await clerk().users.deleteUser(id)
    const { count } = await db.from('members').select('id', { count: 'exact', head: true }).eq('email', email)
    return { members: rows.length, left: count ?? 0 }
  }

  throw new Error('Commands: issue-consent <json> | link <recipient id> | purge <member id>... | clerk-user <id> | remove <email> [<clerk id>]')
}

main().then(
  (out) => { process.stdout.write(`${JSON.stringify(out)}\n`) },
  (err) => { console.error(err instanceof Error ? err.message : err); process.exit(1) },
)
