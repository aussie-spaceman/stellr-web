/**
 * check-migration-names.mjs — reject new sequentially-numbered migrations.
 *
 * Runs in `prebuild`, so it gates the build.
 *
 * Migrations 001–148 are numbered sequentially, which works for one person at a
 * time and fails silently for two: both write `149_…`, one is lost, and nothing
 * notices until production and a branch disagree about the schema. It has
 * already happened once here — GO-LIVE-CHECKLIST records a `019_` collision
 * that had to be renumbered.
 *
 * New migrations use the Supabase CLI's timestamp format, which two sessions
 * cannot collide on:
 *
 *   npm run migration:new -- add_thing   →  20260910143022_add_thing.sql
 *
 * Timestamps sort after the legacy numbers lexicographically ("148" < "2026"),
 * so ordering is preserved and the old files stay exactly as they are.
 */
import { readdirSync } from 'node:fs'

const DIR = 'supabase/migrations'

/** The last sequential migration. Anything numeric above this is a new one. */
const LAST_LEGACY = 148

const LEGACY = /^(\d{1,3})_/
const TIMESTAMPED = /^\d{14}_/

const offenders = []

for (const file of readdirSync(DIR)) {
  if (!file.endsWith('.sql')) continue
  if (TIMESTAMPED.test(file)) continue

  const match = file.match(LEGACY)
  if (!match) {
    offenders.push([file, 'unrecognised name — expected <timestamp>_<name>.sql'])
    continue
  }

  if (Number(match[1]) > LAST_LEGACY) {
    offenders.push([file, `sequential number above ${LAST_LEGACY}`])
  }
}

if (offenders.length) {
  console.error('\n✗ migration naming\n')
  for (const [file, why] of offenders) console.error(`  ${file}\n    ${why}`)
  console.error(
    '\n  Sequential numbers collide when two sessions add a migration at the\n' +
      '  same time — one silently overwrites the other. Create new migrations\n' +
      '  with:\n\n      npm run migration:new -- <name>\n\n' +
      `  Files numbered up to ${LAST_LEGACY} are the existing history and are fine.\n`,
  )
  process.exit(1)
}

console.log('✓ migration naming: no new sequential migrations')
