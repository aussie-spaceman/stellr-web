/**
 * Backfill members that were silently dropped before the enum fix.
 *
 * Background: before lib/member-enums.ts + migration 016, group registrations
 * sent human-readable enum values (e.g. "Adult", "School Student Manager") into
 * the members table's Postgres enum columns. That raised 22P02 and, because the
 * upsert was batched, dropped EVERY member in the batch — leaving `participants`
 * rows with `member_id = NULL` and no corresponding `members` row.
 *
 * This script finds those orphaned participants, creates the missing members
 * (normalising enums exactly as app/api/register/group/route.ts now does), and
 * relinks participants.member_id. Members that already exist (matched by email)
 * are left untouched — we only create the truly-missing ones.
 *
 * Prerequisites:
 *   • Migration 016 applied to the target DB (else the enum inserts fail again).
 *   • .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *     pointing at the environment you want to backfill (prod for go-live).
 *
 * Run:
 *   npx tsx scripts/backfill-members.ts            # dry run — prints, writes nothing
 *   npx tsx scripts/backfill-members.ts --apply    # performs the inserts + relinks
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  normalizeGender,
  normalizeAgeBracket,
  normalizeEventRole,
  normalizeGrade,
  normalizeTshirt,
} from '../lib/member-enums'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  process.exit(1)
}

const APPLY = process.argv.includes('--apply')
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

// ── helpers ──────────────────────────────────────────────────────────────────
interface ParticipantRow {
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  date_of_birth: string | null
  grade: string | null
  gender: string | null
  t_shirt_size: string | null
  age_bracket: string | null
  event_role: string | null
}

/** Mirror the member row that register/group/route.ts builds for a participant. */
function buildMember(p: ParticipantRow): Record<string, unknown> {
  const dob = p.date_of_birth ? new Date(p.date_of_birth) : null
  const ageNow =
    dob && !Number.isNaN(dob.getTime())
      ? new Date().getFullYear() - dob.getFullYear()
      : NaN
  const isMinor = Number.isFinite(ageNow) && ageNow < 18
  const isManager = normalizeEventRole(p.event_role) === 'school_student_manager'

  return {
    email: p.email,
    first_name: p.first_name,
    last_name: p.last_name,
    phone: p.phone,
    date_of_birth: p.date_of_birth,
    gender: normalizeGender(p.gender),
    grade: normalizeGrade(p.grade),
    tshirt_size: normalizeTshirt(p.t_shirt_size),
    age_bracket: isMinor ? 'high_school' : normalizeAgeBracket(p.age_bracket),
    event_role: isMinor
      ? isManager
        ? 'school_student_manager'
        : 'participant'
      : normalizeEventRole(p.event_role),
    is_active: true,
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nBackfill members  —  mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}`)
  console.log(`target: ${url}\n`)

  // 1. Orphaned participants: a member upsert that failed leaves member_id NULL.
  const { data: orphans, error } = await db
    .from('participants')
    .select(
      'email, first_name, last_name, phone, date_of_birth, grade, gender, t_shirt_size, age_bracket, event_role'
    )
    .is('member_id', null)

  if (error) {
    console.error('❌  Failed to query participants:', error.message)
    process.exit(1)
  }

  const rows = (orphans ?? []).filter((p) => p.email) as ParticipantRow[]
  if (rows.length === 0) {
    console.log('✅  No orphaned participants (all have member_id). Nothing to backfill.')
    return
  }

  // Dedupe by lowercased email, last wins (matches the route's in-batch behaviour).
  const byEmail = new Map<string, ParticipantRow>()
  for (const p of rows) byEmail.set(p.email!.toLowerCase(), p)
  const emails = [...byEmail.keys()]
  console.log(`Found ${rows.length} orphaned participant rows → ${emails.length} unique emails.\n`)

  // 2. Which of those emails already have a member? Don't recreate or overwrite them.
  const { data: existing, error: exErr } = await db
    .from('members')
    .select('id, email')
    .in('email', [...byEmail.values()].map((p) => p.email!))
  if (exErr) {
    console.error('❌  Failed to query existing members:', exErr.message)
    process.exit(1)
  }
  const existingByEmail = new Map<string, string>()
  for (const m of existing ?? []) existingByEmail.set((m.email as string).toLowerCase(), m.id as string)

  const toCreate = [...byEmail.entries()].filter(([e]) => !existingByEmail.has(e))
  const alreadyMember = emails.length - toCreate.length

  console.log(`  • ${toCreate.length} members to CREATE`)
  console.log(`  • ${alreadyMember} already have a member (will only relink the participant)\n`)

  // Preview the members we'd create.
  for (const [, p] of toCreate) {
    const m = buildMember(p)
    console.log(
      `    create  ${m.email}  (${m.first_name} ${m.last_name})  role=${m.event_role}  age_bracket=${m.age_bracket}`
    )
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write these changes.')
    return
  }

  // 3. Insert the missing members.
  let createdMap = new Map<string, string>()
  if (toCreate.length > 0) {
    const { data: created, error: insErr } = await db
      .from('members')
      .insert(toCreate.map(([, p]) => buildMember(p)))
      .select('id, email')
    if (insErr) {
      console.error('\n❌  Member insert failed:', insErr.message)
      console.error('    (If this is a 22P02 enum error, migration 016 is not applied to this DB.)')
      process.exit(1)
    }
    for (const m of created ?? []) createdMap.set((m.email as string).toLowerCase(), m.id as string)
    console.log(`\n✅  Created ${createdMap.size} members.`)
  }

  // 4. Relink every orphaned participant to its member (existing or new), by email.
  const idByEmail = new Map<string, string>([...existingByEmail, ...createdMap])
  let relinked = 0
  for (const [emailLc, p] of byEmail) {
    const memberId = idByEmail.get(emailLc)
    if (!memberId) continue
    const { error: upErr } = await db
      .from('participants')
      .update({ member_id: memberId })
      .is('member_id', null)
      .eq('email', p.email!)
    if (upErr) console.error(`   ⚠️  relink failed for ${p.email}: ${upErr.message}`)
    else relinked++
  }
  console.log(`✅  Relinked ${relinked} participant email(s) to their member.`)
  console.log('\nDone.')
}

main().catch((e) => {
  console.error('Unexpected error:', e)
  process.exit(1)
})
