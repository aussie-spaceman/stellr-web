/**
 * Medical retention — prints the SQL that deletes medical information 90 days
 * after the event (Privacy Policy §8 and §10, 2 Oct 2026).
 *
 * Event dates live in Sanity, not Postgres, so this reads Sanity (public, no
 * keys) and writes a single transaction for an admin to run in the Supabase SQL
 * editor of the target project. It never connects to the database itself:
 * nobody needs production credentials on a laptop to run it.
 *
 * "Active" events are those that ended less than 90 days ago, are still to
 * come, or have no date in Sanity (kept, to be safe). Everything else is past
 * the line, including slugs Sanity no longer knows — those are old by
 * definition, because registration needs a published event.
 *
 * The SQL:
 *   1. clears participants.health_conditions on every registration that is not
 *      for an active event (except --keep participant ids: incident records);
 *   2. clears members.health_conditions for members with no participation in an
 *      active event (except members behind a --keep participant);
 *   3. strips health_conditions from audit_log rows for members — the audit
 *      trigger copies the whole row on every change, including step 2's;
 *   4. strips it from deletion_archive snapshots.
 * Dietary information is NOT touched: it follows standard retention.
 *
 * Run (monthly — docs/RUNBOOK-privacy-retention-and-deletion.md):
 *   npm run -s retention:medical-sql                 # prints SQL to stdout
 *   npm run -s retention:medical-sql -- --keep <participant-uuid>[,<uuid>…]
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
// Always the production dataset unless told otherwise: event dates are the same
// facts on every environment, and dev's dataset may be a stale copy.
const dataset = process.env.RETENTION_SANITY_DATASET ?? 'production'
const RETENTION_DAYS = 90

if (!projectId) {
  console.error('❌  Missing env: NEXT_PUBLIC_SANITY_PROJECT_ID')
  process.exit(1)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function keepIds(): string[] {
  const i = process.argv.indexOf('--keep')
  if (i < 0) return []
  const ids = (process.argv[i + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const bad = ids.filter((id) => !UUID.test(id))
  if (bad.length) {
    console.error(`❌  --keep takes participant UUIDs; not one: ${bad.join(', ')}`)
    process.exit(1)
  }
  return ids
}

interface SanityEvent { slug: string; date?: string | null; endDate?: string | null }

async function events(): Promise<SanityEvent[]> {
  const query = '*[_type=="event" && defined(slug.current)]{ "slug": slug.current, date, endDate }'
  const url = `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(query)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { result?: SanityEvent[] }).result ?? []
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

async function main() {
  const now = new Date()
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const all = await events()
  const active: string[] = []
  const expired: string[] = []
  for (const e of all) {
    const end = e.endDate ?? e.date
    if (!end || new Date(end) >= cutoff) active.push(e.slug)
    else expired.push(e.slug)
  }
  if (active.length === 0) throw new Error('No active events found — refusing to emit SQL that would clear everything.')

  const keep = keepIds()
  const activeList = active.sort().map(lit).join(', ')
  const keepClause = keep.length ? `\n  AND p.id NOT IN (${keep.map(lit).join(', ')})` : ''
  const keepMembers = keep.length
    ? `\n  AND m.id NOT IN (SELECT member_id FROM participants WHERE member_id IS NOT NULL AND id IN (${keep.map(lit).join(', ')}))`
    : ''

  process.stderr.write(
    `Sanity ${dataset}: ${all.length} events — ${active.length} active (ended after ${cutoff.toISOString().slice(0, 10)}, upcoming, or undated), ${expired.length} past the ${RETENTION_DAYS}-day line.\n` +
      `Kept for incident records: ${keep.length} participant(s).\n\n`,
  )

  console.log(`-- Medical retention, generated ${now.toISOString()} (Sanity dataset: ${dataset})
-- Clears medical information more than ${RETENTION_DAYS} days after the event. Dietary is untouched.
-- Run in the Supabase SQL editor. Check the counts in the SELECT before COMMIT.
BEGIN;

-- 0. What will change
SELECT
  (SELECT count(*) FROM participants p JOIN registrations r ON r.id = p.registration_id
     WHERE p.health_conditions IS NOT NULL AND r.event_slug NOT IN (${activeList})${keepClause}) AS participants_to_clear,
  (SELECT count(*) FROM members m WHERE m.health_conditions IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM participants p JOIN registrations r ON r.id = p.registration_id
                     WHERE p.member_id = m.id AND r.event_slug IN (${activeList}))${keepMembers}) AS members_to_clear;

-- 1. Per-event records
UPDATE participants p SET health_conditions = NULL
FROM registrations r
WHERE r.id = p.registration_id
  AND p.health_conditions IS NOT NULL
  AND r.event_slug NOT IN (${activeList})${keepClause};

-- 2. Saved profile copy, for members with no active event
UPDATE members m SET health_conditions = NULL
WHERE m.health_conditions IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM participants p JOIN registrations r ON r.id = p.registration_id
                  WHERE p.member_id = m.id AND r.event_slug IN (${activeList}))${keepMembers};

-- 3. Audit copies (the members trigger copies whole rows, including step 2's)
UPDATE audit_log
SET old_data = CASE WHEN old_data ? 'health_conditions' THEN old_data - 'health_conditions' ELSE old_data END,
    new_data = CASE WHEN new_data ? 'health_conditions' THEN new_data - 'health_conditions' ELSE new_data END
WHERE table_name = 'members'
  AND (old_data ? 'health_conditions' OR new_data ? 'health_conditions');

-- 4. Deletion snapshots
UPDATE deletion_archive SET snapshot = snapshot - 'health_conditions'
WHERE snapshot ? 'health_conditions';

COMMIT;`)
}

main().catch((e) => {
  console.error('❌ ', e)
  process.exit(1)
})
