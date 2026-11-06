/**
 * Map today's roles into the S3 tenancy tables (multi-tenancy plan S3, step 5).
 * DATA ONLY: under the default AUTHZ_SOURCE=clerk no guard reads tenant_memberships
 * or platform_admins, so this changes nobody's access. The Clerk `role` claim,
 * staff_roles and event_manager_assignments stay the authority until the flip.
 *
 *   npx tsx scripts/map-tenancy-roles.ts                                # dry run (default): prints the plan
 *   npx tsx scripts/map-tenancy-roles.ts --check                        # read-only: exit 1 on drift, 0 on none
 *   npx tsx scripts/map-tenancy-roles.ts --apply                        # writes Stellr tenant_memberships
 *   npx tsx scripts/map-tenancy-roles.ts --apply --platform-admins      # OWNER ONLY: also writes platform_admins
 *   ... --production                                                    # required to write to production
 *
 * Mapping (lib/tenancy/role-mapping.ts):
 *   Clerk admins (public_metadata.role = 'admin') -> Stellr tenant_admin, and
 *                                                    platform_admins (owner flag only)
 *   event_manager_assignments                     -> Stellr event_manager (one per person)
 *   staff_roles                                   -> Stellr staff (by member)
 *
 * --check (S5 C9) compares those authorities with the tables: all of Stellr's
 * rows, and for other tenants event_manager rows and assignments. The admin
 * screens, event deletion and set-admin keep the rows in step. Run it after any
 * change made another way (a role set in the Clerk dashboard above all, or
 * seed-test-accounts on dev) and immediately before each AUTHZ_SOURCE change.
 * It fails on a missing or stale membership, a platform_admins row without the
 * Clerk admin role, and a Clerk event_manager role and assignments that disagree.
 * A Clerk admin who is not in platform_admins is listed but does not fail: that
 * list is the owner's decision. --check never repairs: --apply adds what is
 * missing for Stellr, and a stale row is for a person to read and remove.
 *
 * platform_admins is the future super-admin list, so only the owner writes it,
 * after reading the dry run (docs/TENANCY-S3.md, "Owner actions"). Ids are
 * printed so the owner can check them; the output stays on the owner's
 * machine — never paste it into the repo (it is public).
 *
 * Prerequisites (.env.local or the shell): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SECRET_KEY, CLERK_SECRET_KEY for the SAME environment (sk_live with
 * the production project, sk_test with dev). The script refuses a mismatch.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClerkClient } from '@clerk/backend'
import { supabaseServer } from '../lib/supabase'
import { SECRET_KEY_VARS, supabaseSecretKey } from '../lib/supabase-keys'
import { diffRoleMapping, formatRoleDrift, planRoleMapping, roleDriftCount } from '../lib/tenancy/role-mapping'
import { loadRoleInput, type ClerkRoleUser } from '../lib/authz/role-sync'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

// Nothing imported above reads env at module scope (lib/supabase reads it
// lazily, the Clerk client is created below), so loading .env.local here is safe.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const CHECK = process.argv.includes('--check')
const PLATFORM_ADMINS = process.argv.includes('--platform-admins')
const PRODUCTION_OK = process.argv.includes('--production')

async function clerkRoleUsers(secretKey: string): Promise<ClerkRoleUser[]> {
  const clerk = createClerkClient({ secretKey })
  const users: ClerkRoleUser[] = []
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerk.users.getUserList({ limit: 100, offset })
    for (const u of data) users.push({ id: u.id, role: (u.publicMetadata as { role?: string } | undefined)?.role })
    if (data.length < 100) break
  }
  return users
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clerkSecret = process.env.CLERK_SECRET_KEY
  const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !supabaseSecretKey() && SECRET_KEY_VARS, !clerkSecret && 'CLERK_SECRET_KEY'].filter(Boolean)
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`)
    process.exit(1)
  }
  const isProduction = url!.includes(PRODUCTION_SUPABASE_REF)
  const clerkLive = clerkSecret!.startsWith('sk_live_')
  if (isProduction !== clerkLive) {
    console.error('Supabase and Clerk point at different environments (production project with sk_test, or the reverse). Refusing.')
    process.exit(1)
  }
  if (CHECK && APPLY) {
    console.error('--check is read-only; it cannot be combined with --apply.')
    process.exit(1)
  }
  if (APPLY && isProduction && !PRODUCTION_OK) {
    console.error('Refusing to write to PRODUCTION without --production (an owner action: docs/TENANCY-S3.md).')
    process.exit(1)
  }
  if (PLATFORM_ADMINS && !APPLY) {
    console.error('--platform-admins only means something with --apply (the dry run always shows the platform-admin plan).')
    process.exit(1)
  }

  const db = supabaseServer()
  const clerkUsers = await clerkRoleUsers(clerkSecret!)
  let input
  try {
    input = await loadRoleInput(db, clerkUsers)
  } catch (err) {
    console.error(`${err instanceof Error ? err.message : err}\n(Are migrations 20261104100000+ applied?)`)
    process.exit(1)
  }

  if (CHECK) {
    const drift = diffRoleMapping(input)
    const count = roleDriftCount(drift)
    console.log(`CHECK against ${isProduction ? 'PRODUCTION' : 'a non-production project'}\n`)
    for (const line of formatRoleDrift(drift)) console.log(`  ${line}`)
    console.log(`\nDrift: ${count}`)
    console.log(`Clerk admins not in platform_admins (the owner's decision, not drift): ${drift.clerkAdminsNotPlatform.length}`)
    process.exit(count > 0 ? 1 : 0)
  }

  const plan = planRoleMapping(input)

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against ${isProduction ? 'PRODUCTION' : 'a non-production project'}\n`)
  console.log(`Clerk admins: ${input.clerkAdminIds.length}`)
  console.log(`platform_admins to add (owner flag --platform-admins): ${plan.platformAdmins.length}`)
  for (const id of plan.platformAdmins) console.log(`  + platform_admin  ${id}`)
  console.log(`tenant_memberships to add for Stellr: ${plan.memberships.length} (already present: ${plan.alreadyPresent})`)
  for (const m of plan.memberships) console.log(`  + ${m.role.padEnd(13)} clerk=${m.clerk_user_id ?? '-'} member=${m.member_id ?? '-'}`)

  if (!APPLY) {
    console.log('\nDry run: nothing written.')
    return
  }
  if (plan.memberships.length) {
    const { error } = await db.from('tenant_memberships').insert(plan.memberships)
    if (error) {
      console.error(`tenant_memberships insert failed: ${error.message}`)
      process.exit(1)
    }
  }
  console.log(`\nWrote ${plan.memberships.length} tenant_membership(s).`)
  if (PLATFORM_ADMINS && plan.platformAdmins.length) {
    const { error } = await db
      .from('platform_admins')
      .insert(plan.platformAdmins.map((id) => ({ clerk_user_id: id, granted_by: 'owner' })))
    if (error) {
      console.error(`platform_admins insert failed: ${error.message}`)
      process.exit(1)
    }
    console.log(`Wrote ${plan.platformAdmins.length} platform_admin(s).`)
  } else if (plan.platformAdmins.length) {
    console.log('platform_admins NOT written (owner action: re-run with --platform-admins).')
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
