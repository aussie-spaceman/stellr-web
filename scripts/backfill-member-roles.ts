#!/usr/bin/env npx tsx
/**
 * Backfill member_roles for members who hold no role rows at all.
 *
 * Background: syncMemberClassificationRole was only called on the Clerk
 * webhook's CREATE branch, but the onboarding POST usually creates the member
 * row first — so the webhook took its LINK branch and never seeded roles, and
 * the onboarding route (the only place that knows the declared event_role)
 * never called the sync either. Fixed in the 13 Aug 2026 teacher-onboarding
 * work; this repairs the members who registered before that deploy.
 *
 * Consequence for them: a teacher holds the Educator TIER (so the Educator Tier
 * Space opens) but not the 'teacher' ROLE, so the Teachers' Room stays shut.
 *
 * This calls the application's own syncMemberClassificationRole rather than
 * reimplementing the mapping in SQL, so the rows it writes are exactly the rows
 * signup would have written — including the age-bracket filter that stops, say,
 * a high-school registrant being given a manage role.
 *
 * Safe to re-run: only members with ZERO role rows are touched, and the sync
 * itself is an insert-or-ignore upsert.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   pointing at the environment you want to repair (prod, here).
 *
 * Run:
 *   npx tsx scripts/backfill-member-roles.ts           # dry run — prints, writes nothing
 *   npx tsx scripts/backfill-member-roles.ts --apply   # performs the writes
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import {
  syncMemberClassificationRole,
  classificationRolesFor,
  roleAllowedForBracket,
} from '../lib/member-roles'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const APPLY = process.argv.includes('--apply')

interface Row {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  event_role: string | null
  age_bracket: string | null
}

async function main() {
  console.log(`\nBackfill member_roles — ${APPLY ? 'APPLY' : 'DRY RUN'}`)
  console.log(`Target: ${url}\n`)

  // Everyone who currently has no role rows. Two queries rather than a NOT
  // EXISTS join, because PostgREST can't express the anti-join directly.
  const { data: withRoles, error: rolesErr } = await db.from('member_roles').select('member_id')
  if (rolesErr) throw new Error(`reading member_roles: ${rolesErr.message}`)
  const haveRoles = new Set((withRoles ?? []).map((r) => r.member_id as string))

  const { data: members, error: memErr } = await db
    .from('members')
    .select('id, email, first_name, last_name, event_role, age_bracket')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (memErr) throw new Error(`reading members: ${memErr.message}`)

  const targets = ((members ?? []) as Row[]).filter((m) => !haveRoles.has(m.id))

  if (targets.length === 0) {
    console.log('Nothing to do — every active member already holds at least one role.\n')
    return
  }

  console.log(`${targets.length} member(s) with no roles:\n`)

  let wrote = 0
  for (const m of targets) {
    // Mirror what the sync will do, for the printed plan. The sync itself is
    // the authority — this only describes it.
    const implied = classificationRolesFor(m.event_role ?? '')
    const allowed = implied.filter((r) => roleAllowedForBracket(r, m.age_bracket))
    const dropped = implied.filter((r) => !allowed.includes(r))
    const planned = ['member', ...allowed]

    const name = `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || '(no name)'
    console.log(
      `  ${(m.email ?? m.id).padEnd(38)} ${String(m.event_role ?? '—').padEnd(22)}` +
        ` ${String(m.age_bracket ?? '—').padEnd(12)} → ${planned.join(', ')}` +
        (dropped.length ? `   [dropped by bracket: ${dropped.join(', ')}]` : '') +
        `   ${name}`,
    )

    if (APPLY) {
      await syncMemberClassificationRole(db, m.id, m.event_role ?? 'subscriber')
      wrote++
    }
  }

  console.log('')
  if (!APPLY) {
    console.log(`Dry run — nothing written. Re-run with --apply to write.\n`)
    return
  }

  // Verify by re-reading, rather than trusting the writes.
  const { data: after } = await db
    .from('member_roles')
    .select('member_id, role')
    .in('member_id', targets.map((t) => t.id))

  const byMember = new Map<string, string[]>()
  for (const r of after ?? []) {
    const list = byMember.get(r.member_id as string) ?? []
    list.push(r.role as string)
    byMember.set(r.member_id as string, list)
  }

  const stillEmpty = targets.filter((t) => !byMember.has(t.id))
  console.log(`Synced ${wrote} member(s); ${byMember.size} now hold roles, ${after?.length ?? 0} rows total.`)
  if (stillEmpty.length) {
    console.log(`\n⚠  ${stillEmpty.length} member(s) still have no roles:`)
    for (const m of stillEmpty) console.log(`   ${m.email ?? m.id}`)
    process.exitCode = 1
  } else {
    console.log('Every targeted member now holds at least the base role.\n')
  }
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
