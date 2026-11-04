/**
 * Map today's roles into the S3 tenancy tables (multi-tenancy plan S3, step 5).
 * DATA ONLY: no guard reads tenant_memberships or platform_admins yet, so this
 * changes nobody's access. The Clerk `role` claim, staff_roles and
 * event_manager_assignments stay the authority until S5.
 *
 *   npx tsx scripts/map-tenancy-roles.ts                                # dry run (default): prints the plan
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
import { planRoleMapping } from '../lib/tenancy/role-mapping'
import { PRODUCTION_SUPABASE_REF } from './production-guard.mjs'

// Nothing imported above reads env at module scope (lib/supabase reads it
// lazily, the Clerk client is created below), so loading .env.local here is safe.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const PLATFORM_ADMINS = process.argv.includes('--platform-admins')
const PRODUCTION_OK = process.argv.includes('--production')

async function clerkAdminIds(secretKey: string): Promise<string[]> {
  const clerk = createClerkClient({ secretKey })
  const ids: string[] = []
  for (let offset = 0; ; offset += 100) {
    const { data } = await clerk.users.getUserList({ limit: 100, offset })
    for (const u of data) {
      if ((u.publicMetadata as { role?: string } | undefined)?.role === 'admin') ids.push(u.id)
    }
    if (data.length < 100) break
  }
  return ids
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
  if (APPLY && isProduction && !PRODUCTION_OK) {
    console.error('Refusing to write to PRODUCTION without --production (an owner action: docs/TENANCY-S3.md).')
    process.exit(1)
  }
  if (PLATFORM_ADMINS && !APPLY) {
    console.error('--platform-admins only means something with --apply (the dry run always shows the platform-admin plan).')
    process.exit(1)
  }

  const db = supabaseServer()
  const [admins, managers, staff, members, memberships, platform] = await Promise.all([
    clerkAdminIds(clerkSecret!),
    db.from('event_manager_assignments').select('clerk_user_id'),
    db.from('staff_roles').select('member_id'),
    db.from('members').select('id, clerk_user_id').not('clerk_user_id', 'is', null),
    db.from('tenant_memberships').select('tenant_id, clerk_user_id, member_id, role'),
    db.from('platform_admins').select('clerk_user_id'),
  ])
  for (const r of [managers, staff, members, memberships, platform]) {
    if (r.error) {
      console.error(`Read failed: ${r.error.message}\n(Are migrations 20261104100000+ applied?)`)
      process.exit(1)
    }
  }
  const clerkByMember = new Map(((members.data ?? []) as { id: string; clerk_user_id: string }[]).map((m) => [m.id, m.clerk_user_id]))

  const plan = planRoleMapping({
    clerkAdminIds: admins,
    eventManagers: (managers.data ?? []) as { clerk_user_id: string }[],
    staff: ((staff.data ?? []) as { member_id: string }[]).map((s) => ({
      member_id: s.member_id,
      clerk_user_id: clerkByMember.get(s.member_id) ?? null,
    })),
    existingMemberships: (memberships.data ?? []) as { tenant_id: string; clerk_user_id: string | null; member_id: string | null; role: string }[],
    existingPlatformAdmins: (platform.data ?? []) as { clerk_user_id: string }[],
  })

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} against ${isProduction ? 'PRODUCTION' : 'a non-production project'}\n`)
  console.log(`Clerk admins: ${admins.length}`)
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
