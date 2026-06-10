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
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClerkClient } from '@clerk/backend'

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

if (!email) {
  console.error('Usage: npx tsx scripts/set-admin.ts <email> [--revoke] [--apply]')
  process.exit(1)
}

const clerk = createClerkClient({ secretKey: secret })
const targetRole = REVOKE ? undefined : 'admin'

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
    console.log('\n✅  Already in the desired state. Nothing to do.')
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
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
