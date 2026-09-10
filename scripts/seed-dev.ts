/**
 * seed-dev.ts — apply supabase/seed.sql to a NON-PRODUCTION database.
 *
 *   npm run seed:dev
 *
 * Requires DEV_DATABASE_URL: the dev project's **Session pooler** connection
 * string, from Supabase → Connect → Session pooler. The direct `db.<ref>` host
 * is IPv6-only and the transaction pooler (port 6543) cannot run this script.
 *
 * The guards below are the point of this file. Seeding is the one routine
 * operation that writes fixture rows in bulk, so pointing it at production by
 * accident would be uniquely destructive — and the two databases differ by a
 * dozen characters in a connection string. So the production ref is refused by
 * name, and anything that does not positively identify as the dev project is
 * refused too: an unrecognised target fails closed rather than open.
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Read .env.local — see the note in scripts/db-status.mjs. Same trap: the
// guidance said to set DEV_DATABASE_URL there, and nothing read the file.
if (existsSync('.env.local')) process.loadEnvFile('.env.local')

/** The dev Supabase project. Only this ref may be seeded. */
const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'

/** Named explicitly so the refusal message can say *which* database it stopped. */
const PROD_PROJECT_REF = 'hwtzpfrnksksxlwwabqz'

const SEED_FILE = 'supabase/seed.sql'

/** pg_dump 18 emits a `\restrict` directive, so the loader must be psql 18+. */
const PSQL_CANDIDATES = [
  '/opt/homebrew/opt/libpq/bin/psql',
  '/usr/local/opt/libpq/bin/psql',
  'psql',
]

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function resolvePsql(): string {
  for (const candidate of PSQL_CANDIDATES) {
    if (candidate === 'psql' || existsSync(candidate)) return candidate
  }
  return fail(
    'psql not found. Install the client tools with `brew install libpq` — the ' +
      'full Postgres server is not needed.',
  )
}

function main() {
  const url = process.env.DEV_DATABASE_URL?.trim()

  if (!url) {
    fail(
      'DEV_DATABASE_URL is not set.\n' +
        '  Supabase → dev project → Connect → Session pooler → copy the URI,\n' +
        '  substitute the password, and add it to .env.local.',
    )
  }

  if (url.includes(PROD_PROJECT_REF)) {
    fail(
      `DEV_DATABASE_URL points at the PRODUCTION project (${PROD_PROJECT_REF}).\n` +
        '  Refusing to seed. This script writes fixture rows; against production\n' +
        '  that would put test members and registrations in the live database.',
    )
  }

  if (!url.includes(DEV_PROJECT_REF)) {
    fail(
      `DEV_DATABASE_URL does not name the dev project (${DEV_PROJECT_REF}).\n` +
        '  Refusing to seed an unrecognised database. If you have moved the dev\n' +
        '  project, update DEV_PROJECT_REF in scripts/seed-dev.ts deliberately —\n' +
        '  this check is meant to be edited by a human, not bypassed.',
    )
  }

  // Belt and braces: even a correctly-targeted seed should not run while the
  // process believes it is production.
  if (process.env.NEXT_PUBLIC_APP_ENV === 'prod') {
    fail('NEXT_PUBLIC_APP_ENV=prod. Refusing to seed.')
  }

  if (!existsSync(SEED_FILE)) {
    fail(`${SEED_FILE} not found. Run this from the repository root.`)
  }

  const psql = resolvePsql()
  console.log(`Seeding ${DEV_PROJECT_REF} from ${SEED_FILE} …\n`)

  try {
    execFileSync(
      psql,
      [
        url,
        '--set', 'ON_ERROR_STOP=1', // a half-applied seed is worse than none
        '--no-psqlrc',              // ignore any local ~/.psqlrc
        '-f', SEED_FILE,
      ],
      { stdio: 'inherit' },
    )
  } catch {
    fail('Seed failed. Nothing was committed — seed.sql runs in a transaction.')
  }

  console.log(
    '\n✓ Seeded.\n' +
      '  Fixture members are ' +
      '00000000-0000-4000-a000-00000000000{1..5}; see the note at the end of\n' +
      '  seed.sql for linking them to Clerk development users.\n',
  )
}

main()
