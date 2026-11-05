/**
 * Grant or revoke the `admin` role for a Clerk user, by email.
 *
 * Admin access is gated entirely on the Clerk session-token claim
 * `sessionClaims.metadata.role === 'admin'` (see app/api/admin/* and the member
 * layout) — there is no DB fallback. The role comes from the user's Clerk
 * `public_metadata.role`, surfaced into the token by the instance's custom
 * session-token claim `{"metadata": "{{user.public_metadata}}"}`.
 *
 * This script sets/removes that public_metadata via the Clerk Backend API, so it
 * works even for the very first admin (an admin-gated API route couldn't, since
 * no one has the role yet). It targets whichever instance CLERK_SECRET_KEY points
 * at — sk_live = production, sk_test = development.
 *
 * Usage:
 *   npx tsx scripts/set-admin.ts someone@stellreducation.org           # dry run — show current state
 *   npx tsx scripts/set-admin.ts someone@stellreducation.org --apply   # grant admin
 *   npx tsx scripts/set-admin.ts someone@stellreducation.org --revoke --apply   # remove admin
 *
 * NOTE: the change only takes effect on the user's NEXT token — they must sign
 * out and back in (or wait for the session token to refresh) before /admin works.
 *
 * S5 C9 dual-write: with --apply it also writes the Stellr tenant_admin membership
 * to the Supabase project in this environment, or removes it on --revoke, and it
 * repairs that row when Clerk is already in the desired state. Clerk stays the
 * authority: the Clerk change happens first and is never undone. If the Postgres
 * write fails or is skipped, the script says so and exits 2.
 *
 *   ... --production        also needed to write memberships on the production project
 *   ... --platform-admins   OWNER ONLY: also writes or removes the platform_admins row
 *
 * Without --platform-admins, platform_admins is never touched. A revoke says so
 * when the person is still in it. `map-tenancy-roles --check` reports the rest.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClerkClient } from '@clerk/backend'
import { supabaseServer } from '../lib/supabase'
import { supabaseSecretKey } from '../lib/supabase-keys'
import { dualWriteConsequence, dualWriteTarget } from '../lib/tenancy/role-mapping'
import {
  isPlatformAdminRow,
  syncPlatformAdminGranted,
  syncPlatformAdminRevoked,
  syncTenantAdminGranted,
  syncTenantAdminRevoked,
  type RoleSyncResult,
} from '../lib/authz/role-sync'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const secret = process.env.CLERK_SECRET_KEY
if (!secret) {
  console.error('❌  CLERK_SECRET_KEY must be set in .env.local')
  process.exit(1)
}

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--'))
const APPLY = args.includes('--apply')
const REVOKE = args.includes('--revoke')
const PRODUCTION_OK = args.includes('--production')
const PLATFORM_ADMINS = args.includes('--platform-admins')

if (!email) {
  console.error('Usage: npx tsx scripts/set-admin.ts <email> [--revoke] [--apply] [--production] [--platform-admins]')
  process.exit(1)
}
if (PLATFORM_ADMINS && !APPLY) {
  console.error('--platform-admins only means something with --apply.')
  process.exit(1)
}

const clerk = createClerkClient({ secretKey: secret })
const targetRole = REVOKE ? undefined : 'admin'

/** Runs after the Clerk state is right. Never fails the Clerk change: it reports, and sets exit code 2. */
async function syncPostgres(clerkUserId: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const target = dualWriteTarget({
    hasDbCredentials: !!supabaseUrl && !!supabaseSecretKey(),
    isProductionDb: !!supabaseUrl && supabaseUrl.includes(PRODUCTION_SUPABASE_REF),
    clerkLive: secret!.startsWith('sk_live_'),
    productionFlag: PRODUCTION_OK,
  })
  const warn = (message: string) => {
    console.error(`\n⚠️   ${message}`)
    console.error(`    ${dualWriteConsequence(REVOKE)}`)
    console.error('    Fix it, then run: npx tsx scripts/map-tenancy-roles.ts --check')
    process.exitCode = 2
  }
  const report = (label: string, result: RoleSyncResult) => {
    if (result.ok) console.log(`   ${label}: done.`)
    else warn(`${label} failed (step ${result.step}, code ${result.code}).`)
  }

  if (!target.write) {
    warn(`Postgres memberships NOT written: ${target.reason}.`)
    return
  }
  const db = supabaseServer()
  report(`tenant_admin membership ${REVOKE ? 'removal' : 'write'}`, await (REVOKE ? syncTenantAdminRevoked : syncTenantAdminGranted)(db, clerkUserId))
  if (PLATFORM_ADMINS) {
    report(`platform_admins ${REVOKE ? 'removal' : 'write'}`, await (REVOKE ? syncPlatformAdminRevoked : syncPlatformAdminGranted)(db, clerkUserId))
  } else if (REVOKE) {
    const held = await isPlatformAdminRow(db, clerkUserId)
    if (held !== false) {
      warn(held ? 'Still in platform_admins. Only the owner removes that row: re-run with --platform-admins.' : 'Could not read platform_admins to see whether this person is still in it.')
    }
  }
}

async function main() {
  console.log(`\nSet admin role  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`instance: ${secret!.startsWith('sk_live') ? 'PRODUCTION (sk_live)' : 'development/test'}`)
  console.log(`action:   ${REVOKE ? 'REVOKE admin from' : 'GRANT admin to'}  ${email}\n`)

  // Clerk's list filter is exact-match on emailAddress.
  const { data: users } = await clerk.users.getUserList({ emailAddress: [email!] })
  if (users.length === 0) {
    console.error(`❌  No Clerk user found with email ${email} on this instance.`)
    console.error('    (Remember: production and dev are separate user stores.)')
    process.exit(1)
  }
  if (users.length > 1) {
    console.error(`❌  ${users.length} users match ${email}; refusing to guess. Resolve by user id manually.`)
    process.exit(1)
  }

  const user = users[0]
  const currentRole = (user.publicMetadata as { role?: string } | undefined)?.role ?? '(none)'
  console.log(`  user id:      ${user.id}`)
  console.log(`  current role: ${currentRole}`)
  console.log(`  target role:  ${targetRole ?? '(none)'}`)

  if (currentRole === (targetRole ?? '(none)')) {
    console.log('\n✅  Clerk is already in the desired state.')
    if (APPLY) await syncPostgres(user.id)
    return
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to make this change.')
    return
  }

  // Preserve any other public_metadata keys; only touch `role`.
  const nextMeta = { ...(user.publicMetadata ?? {}) } as Record<string, unknown>
  if (REVOKE) delete nextMeta.role
  else nextMeta.role = 'admin'

  await clerk.users.updateUserMetadata(user.id, { publicMetadata: nextMeta })

  console.log(`\n✅  ${REVOKE ? 'Revoked admin from' : 'Granted admin to'} ${email}.`)
  console.log('   They must sign out and back in (or wait for token refresh) for it to take effect.')

  await syncPostgres(user.id)
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
