/**
 * Seed a full set of QA test accounts — one per Stellr role — for manual
 * black-box testing of app.stellreducation.org against the provider user stories.
 *
 * For each persona this script:
 *   1. Finds-or-creates a Clerk user (email + password) on whichever instance
 *      CLERK_SECRET_KEY points at (sk_test = dev/staging, sk_live = prod).
 *   2. Finds-or-creates the matching `members` row and links `clerk_user_id`
 *      (the same linkage the app/api/webhooks/clerk webhook maintains).
 *   3. Grants the persona's membership tier (member_memberships → membership_tiers)
 *      and canonical roles (member_roles), plus Clerk public_metadata.role='admin'
 *      for the admin persona.
 *   4. Links a test school where the role needs one (student / student_manager / teacher).
 *
 * It is IDEMPOTENT: re-running matches existing users/members by email and only
 * fills what's missing. Dry-run by default; pass --apply to write.
 *
 * ── Auth / env (put in .env.local, pointed at your STAGING project) ────────────
 *   NEXT_PUBLIC_SUPABASE_URL      staging Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY     staging service-role key (bypasses RLS)
 *   CLERK_SECRET_KEY              sk_test_… for the staging Clerk instance
 *
 * ── Seed config (all optional; sensible defaults) ──────────────────────────────
 *   SEED_EMAIL_DOMAIN   domain for the generated addresses (default: stellr-qa.test)
 *   SEED_EMAIL_LOCAL    local-part prefix (default: qa)  → qa+student@<domain>
 *   SEED_PASSWORD       password set on every Clerk test user (required with --apply)
 *   SEED_CLERK_TEST     "1" to append +clerk_test so a DEV Clerk instance auto-verifies
 *                       the email (bypass code is 424242). Recommended for dev/staging.
 *
 * ── Run ────────────────────────────────────────────────────────────────────────
 *   npx tsx scripts/seed-test-accounts.ts            # dry run — prints the plan, writes nothing
 *   npx tsx scripts/seed-test-accounts.ts --apply    # create the accounts
 *   npx tsx scripts/seed-test-accounts.ts --only teacher,admin --apply   # subset
 *
 * ⚠️  NEVER run with an sk_live CLERK_SECRET_KEY / prod Supabase — this creates
 *     real logins and member records. It refuses to run against sk_live unless
 *     you also pass --i-understand-this-is-prod.
 *
 * NOTE on admin: the Clerk metadata change only takes effect on the user's NEXT
 * token — sign the admin user out/in before /admin works.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClerkClient } from '@clerk/backend'
import {
  VALID_AGE_BRACKETS,
  VALID_EVENT_ROLES,
} from '../lib/member-enums'
import { syncMemberClassificationRole, addGlobalRole, type MemberRole } from '../lib/member-roles'

// ── env ────────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const clerkSecret = process.env.CLERK_SECRET_KEY
if (!url || !serviceKey) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  process.exit(1)
}
if (!clerkSecret) {
  console.error('❌  CLERK_SECRET_KEY must be set in .env.local')
  process.exit(1)
}

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const PROD_OK = argv.includes('--i-understand-this-is-prod')
const onlyArg = argv.find((a) => a.startsWith('--only='))?.split('=')[1]
  ?? (argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined)
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null

const isLive = clerkSecret.startsWith('sk_live')
if (isLive && !PROD_OK) {
  console.error('❌  CLERK_SECRET_KEY is sk_live (PRODUCTION). Refusing to seed test accounts into prod.')
  console.error('    If you really mean it, re-run with --i-understand-this-is-prod')
  process.exit(1)
}

const DOMAIN = process.env.SEED_EMAIL_DOMAIN || 'stellr-qa.test'
const LOCAL = process.env.SEED_EMAIL_LOCAL || 'qa'
const CLERK_TEST = process.env.SEED_CLERK_TEST === '1'
const PASSWORD = process.env.SEED_PASSWORD
if (APPLY && !PASSWORD) {
  console.error('❌  SEED_PASSWORD must be set (used as the login password for every seeded Clerk user).')
  process.exit(1)
}

const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } })
const clerk = createClerkClient({ secretKey: clerkSecret })

// ── personas ─────────────────────────────────────────────────────────────────
// event_role values MUST be members.event_role_type enum members (see VALID_EVENT_ROLES).
// tier = membership_tiers.name to grant (looked up by name; skipped if not found).
// extraRoles = member_roles beyond what syncMemberClassificationRole derives.
// school = link a test school via member_schools.  admin = set Clerk metadata.
interface Persona {
  key: string
  firstName: string
  lastName: string
  ageBracket: (typeof VALID_AGE_BRACKETS)[number]
  eventRole: (typeof VALID_EVENT_ROLES)[number]
  dob?: string
  tier?: string
  extraRoles?: MemberRole[]
  school?: boolean
  admin?: boolean
  eventManager?: boolean
  note?: string
}

const PERSONAS: Persona[] = [
  { key: 'subscriber', firstName: 'Sam', lastName: 'Subscriber', ageBracket: 'adult', eventRole: 'subscriber', tier: 'Subscriber',
    note: 'Top-of-funnel free account.' },
  { key: 'student', firstName: 'Stella', lastName: 'Student', ageBracket: 'high_school', eventRole: 'participant', dob: '2010-05-01', tier: 'Explorer', school: true,
    note: 'Minor (dob 2010) so DocuSign/guardian flows apply.' },
  { key: 'student_manager', firstName: 'Morgan', lastName: 'Manager', ageBracket: 'high_school', eventRole: 'school_student_manager', dob: '2008-03-01', tier: 'Explorer', school: true,
    note: 'Student leading a Group — sync adds student_manager + participant roles.' },
  { key: 'teacher', firstName: 'Tara', lastName: 'Teacher', ageBracket: 'adult', eventRole: 'teacher', tier: 'Educator', school: true,
    note: 'Group registration + Teams portal owner.' },
  { key: 'parent', firstName: 'Paula', lastName: 'Parent', ageBracket: 'adult', eventRole: 'parent', tier: 'Parent/Guardian',
    note: 'Guardian / DocuSign signer.' },
  { key: 'donor', firstName: 'Dana', lastName: 'Donor', ageBracket: 'adult', eventRole: 'adult', tier: 'Subscriber', extraRoles: ['donor_sponsor'],
    note: 'Donor tier retired post-migr 094; seeded as adult + donor_sponsor role.' },
  { key: 'mentor', firstName: 'Miguel', lastName: 'Mentor', ageBracket: 'college', eventRole: 'mentor', tier: 'Alumni',
    note: 'College mentor/volunteer; can host Cohort sessions.' },
  { key: 'coach', firstName: 'Cody', lastName: 'Coach', ageBracket: 'adult', eventRole: 'mentor', tier: 'Subscriber', extraRoles: ['coach'],
    note: 'Coach is a member_role (manage axis), not a tier.' },
  { key: 'event_manager', firstName: 'Evan', lastName: 'Events', ageBracket: 'adult', eventRole: 'teacher', tier: 'Educator', extraRoles: ['staff'], eventManager: true,
    note: 'Scoped events admin. Verify staff_roles scope=events against live schema.' },
  { key: 'admin', firstName: 'Alex', lastName: 'Admin', ageBracket: 'adult', eventRole: 'adult', tier: 'Educator', extraRoles: ['staff'], admin: true,
    note: 'Full admin via Clerk public_metadata.role=admin. Must re-auth to take effect.' },
]

const TEST_SCHOOL = {
  name: 'Stellr QA High School',
  address_street: '123 Test Ave',
  address_city: 'Austin',
  address_state: 'TX',
  address_zip: '78701',
}

function emailFor(key: string): string {
  const tag = CLERK_TEST ? `+${key}+clerk_test` : `+${key}`
  return `${LOCAL}${tag}@${DOMAIN}`
}

// ── helpers ────────────────────────────────────────────────────────────────────
async function findClerkUserId(email: string): Promise<string | null> {
  const { data } = await clerk.users.getUserList({ emailAddress: [email] })
  return data[0]?.id ?? null
}

async function ensureClerkUser(p: Persona, email: string): Promise<string | null> {
  const existing = await findClerkUserId(email)
  if (existing) {
    if (p.admin && APPLY) {
      await clerk.users.updateUserMetadata(existing, { publicMetadata: { role: 'admin' } })
    }
    return existing
  }
  if (!APPLY) return null
  const user = await clerk.users.createUser({
    emailAddress: [email],
    password: PASSWORD,
    firstName: p.firstName,
    lastName: p.lastName,
    skipPasswordChecks: true,
    ...(p.admin ? { publicMetadata: { role: 'admin' } } : {}),
  })
  return user.id
}

async function findMemberByEmail(email: string): Promise<{ id: string; clerk_user_id: string | null } | null> {
  const { data } = await db
    .from('members')
    .select('id, clerk_user_id')
    .ilike('email', email)
    .limit(1)
    .maybeSingle()
  return (data as { id: string; clerk_user_id: string | null } | null) ?? null
}

async function ensureMember(p: Persona, email: string, clerkUserId: string | null): Promise<string | null> {
  const existing = await findMemberByEmail(email)
  const row = {
    email: email.toLowerCase(),
    first_name: p.firstName,
    last_name: p.lastName,
    age_bracket: p.ageBracket,
    event_role: p.eventRole,
    is_active: true,
    ...(p.dob ? { date_of_birth: p.dob } : {}),
    ...(clerkUserId ? { clerk_user_id: clerkUserId } : {}),
  }
  if (existing) {
    if (APPLY) await db.from('members').update(row).eq('id', existing.id)
    return existing.id
  }
  if (!APPLY) return null
  const { data, error } = await db.from('members').insert(row).select('id').single()
  if (error) { console.error(`   ✗ member insert failed for ${email}:`, error.message); return null }
  return data.id
}

async function ensureTier(memberId: string, tierName: string): Promise<string> {
  const { data: tier } = await db
    .from('membership_tiers')
    .select('id, name')
    .ilike('name', tierName)
    .limit(1)
    .maybeSingle()
  if (!tier) return `tier "${tierName}" not found — skipped`
  if (!APPLY) return `would grant ${tier.name}`
  // Import grantTier lazily so a dry run needn't touch its supabaseServer() default.
  const { grantTier } = await import('../lib/membership-grants')
  const res = await grantTier(
    { memberId, tierId: tier.id, source: 'system', complimentary: true },
    db,
  )
  return res.granted ? `granted ${tier.name}` : `${tier.name}: ${res.reason}`
}

async function ensureEventManager(memberId: string): Promise<string> {
  if (!APPLY) return 'would add staff_roles scope=events (verify schema)'
  // Best-effort: the staff_roles table shape isn't in tracked migrations.
  const { error } = await db
    .from('staff_roles')
    .upsert({ member_id: memberId, scope: 'events' }, { onConflict: 'member_id,scope', ignoreDuplicates: true })
  return error ? `staff_roles insert skipped: ${error.message}` : 'staff_roles scope=events'
}

// ── main ────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSeed QA test accounts  —  mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`Clerk instance: ${isLive ? 'PRODUCTION (sk_live)' : 'dev/test'}`)
  console.log(`Supabase: ${url}`)
  console.log(`Email pattern: ${emailFor('<role>')}${CLERK_TEST ? '  (clerk_test auto-verify, code 424242)' : ''}\n`)

  const personas = ONLY ? PERSONAS.filter((p) => ONLY.has(p.key)) : PERSONAS
  let sharedSchoolId: string | null = null

  for (const p of personas) {
    const email = emailFor(p.key)
    console.log(`● ${p.key.padEnd(16)} ${email}`)
    try {
      const clerkId = await ensureClerkUser(p, email)
      console.log(`   clerk:  ${clerkId ?? '(would create)'}`)
      const memberId = await ensureMember(p, email, clerkId)
      console.log(`   member: ${memberId ?? '(would create)'}`)

      if (memberId && APPLY) {
        await syncMemberClassificationRole(db, memberId, p.eventRole)
        for (const r of p.extraRoles ?? []) await addGlobalRole(db, memberId, r, 'seed')
        if (p.tier) console.log(`   tier:   ${await ensureTier(memberId, p.tier)}`)
        if (p.school) {
          const { resolveSchoolId } = await import('../lib/school-link')
          sharedSchoolId = sharedSchoolId ?? (await resolveSchoolId(db, { ...TEST_SCHOOL }))
          if (sharedSchoolId) {
            await db.from('member_schools').upsert(
              { member_id: memberId, school_id: sharedSchoolId },
              { onConflict: 'member_id,school_id', ignoreDuplicates: true },
            )
            console.log(`   school: linked ${TEST_SCHOOL.name}`)
          }
        }
        if (p.eventManager) console.log(`   events: ${await ensureEventManager(memberId)}`)
        if (p.admin) console.log(`   admin:  Clerk public_metadata.role=admin set (re-auth required)`)
      } else if (!APPLY) {
        console.log(`   roles:  member + ${p.eventRole}${p.extraRoles ? ' + ' + p.extraRoles.join(',') : ''}`)
        if (p.tier) console.log(`   tier:   ${await ensureTier('dry', p.tier)}`)
        if (p.school) console.log(`   school: would link ${TEST_SCHOOL.name}`)
      }
      if (p.note) console.log(`   note:   ${p.note}`)
    } catch (err) {
      console.error(`   ✗ ${p.key} failed:`, (err as Error).message)
    }
    console.log('')
  }

  console.log(APPLY
    ? '✅  Done. Sign each user in at /sign-in with SEED_PASSWORD. Admin/event-manager: sign out/in first.'
    : 'ℹ️  Dry run only. Re-run with --apply to create the accounts.')
  console.log('    Guest = no account; test by browsing signed-out.\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
