/**
 * db-status.mjs — compare supabase/migrations/ against a database's ledger.
 *
 *   npm run db:status              # the dev project
 *   npm run db:status -- --prod    # production, read-only
 *
 * "Which migrations are applied where" was tribal knowledge here until 9 Sept,
 * and it was wrong: production's ledger was missing eleven versions that had in
 * fact been applied, so the CLI would have tried to re-run them. This makes the
 * answer a command rather than a memory.
 *
 * Read-only. It runs one SELECT against supabase_migrations.schema_migrations
 * and never writes, so pointing it at production is safe — that is the whole
 * point of having a --prod flag rather than making people re-link the CLI.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, existsSync } from 'node:fs'

// Read .env.local, the way every other entry point in this repo does.
//
// WHY: this script's own failure message says to put the URI "into .env.local"
// — and it did not read that file, so following the instruction changed
// nothing and the script failed again, identically. `npm run db:status` had
// therefore never once run successfully; only its refusal path had ever been
// exercised. An error message that prescribes a fix which does not work is
// worse than one that just states the problem.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const DEV_REF = 'xvxlhbxtiwxpopoqjygm'
const PROD_REF = 'hwtzpfrnksksxlwwabqz'

const wantProd = process.argv.includes('--prod')
const ref = wantProd ? PROD_REF : DEV_REF
const label = wantProd ? 'production' : 'dev'

const urlVar = wantProd ? 'PROD_DATABASE_URL' : 'DEV_DATABASE_URL'
const url = process.env[urlVar]?.trim()

if (!url) {
  console.error(
    `\n✗ ${urlVar} is not set.\n` +
      `  Supabase → ${label} project → Connect → Session pooler → copy the URI\n` +
      `  (with password) into .env.local.\n`,
  )
  process.exit(1)
}

if (!url.includes(ref)) {
  console.error(
    `\n✗ ${urlVar} does not name the ${label} project (${ref}).\n` +
      '  Refusing to report on an unrecognised database — a status report about\n' +
      '  the wrong environment is worse than none.\n',
  )
  process.exit(1)
}

const PSQL = ['/opt/homebrew/opt/libpq/bin/psql', '/usr/local/opt/libpq/bin/psql', 'psql'].find(
  (p) => p === 'psql' || existsSync(p),
)

const local = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.split('_')[0])
  .sort()

let remote
try {
  remote = execFileSync(
    PSQL,
    [url, '-At', '--no-psqlrc', '-c', 'select version from supabase_migrations.schema_migrations order by version'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
} catch {
  console.error(`\n✗ Could not read the ledger on ${label}.\n`)
  process.exit(1)
}

const remoteSet = new Set(remote)
const localSet = new Set(local)

const pending = local.filter((v) => !remoteSet.has(v))
const unknown = remote.filter((v) => !localSet.has(v))

console.log(`\nMigrations — local vs ${label} (${ref})\n`)
console.log(`  local files      ${local.length}`)
console.log(`  ledger rows      ${remote.length}`)

if (pending.length) {
  console.log(`\n  PENDING (${pending.length}) — in the repo, not applied:`)
  for (const v of pending) console.log(`    ${v}`)
} else {
  console.log('\n  ✓ nothing pending')
}

if (unknown.length) {
  console.log(`\n  ledger-only (${unknown.length}) — applied, no local file:`)
  for (const v of unknown) console.log(`    ${v}`)
  console.log(
    '\n    Production carries nine of these: migrations 138-148 were applied\n' +
      '    through a path that recorded timestamps instead of file numbers. They\n' +
      '    are a historical record, not a problem.',
  )
}

console.log('')
process.exit(pending.length ? 1 : 0)
