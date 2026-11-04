/**
 * End the Clerk sessions the E2E suite created.
 *
 * WHY: artifacts on a public repo can be downloaded by any signed-in GitHub
 * user. A Playwright report records the fixture sign-ins, including the Clerk
 * dev-browser token in its step data, and traces record session cookies. Those
 * stay usable for as long as the session lives (7 days), so the e2e job runs
 * this BEFORE it uploads the report: what gets published is already dead.
 *
 * By default it ends only the sessions this run recorded (e2e/fixtures/
 * session-ledger.ts), so overlapping runs and local use of the fixture users
 * carry on. No ledger is an error, not a pass: the job then uploads nothing,
 * because it cannot show that the sessions in the report were ended.
 *
 * `--all-fixtures` ends every active session of every fixture user. It is for
 * clean-up by hand, and it signs out any run in progress.
 *
 * Dev instance only: it refuses anything but an `sk_test_` key, so it can never
 * sign real people out of production. It prints counts, never a token, id or
 * address, because CI logs are public too.
 *
 * By hand: npx tsx --env-file=.env.local scripts/revoke-e2e-sessions.ts --all-fixtures
 */
import { readFileSync, rmSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { SESSION_LEDGER } from '../e2e/fixtures/session-ledger'
import { FIXTURES } from '../e2e/fixtures/users'

const API = 'https://api.clerk.com/v1'
const PAGE = 100

function clerkApi(secretKey: string | undefined, fetchImpl: typeof fetch) {
  if (!secretKey?.startsWith('sk_test_')) {
    throw new Error('Refusing to run: CLERK_SECRET_KEY must be a development (sk_test_) key.')
  }
  return async (path: string, method = 'GET') => {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    if (!res.ok) throw new Error(`Clerk ${method} ${path.split('?')[0].replace(/sess_\w+/, 'sess_…')} returned ${res.status}`)
    return res.json()
  }
}

/** Ends the listed sessions. One the run already signed out is left alone. */
export async function revokeRecordedSessions(
  secretKey: string | undefined,
  ledger: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ recorded: number; revoked: number }> {
  const call = clerkApi(secretKey, fetchImpl)
  const ids = [...new Set(ledger.split('\n').map((line) => line.trim()).filter(Boolean))]

  let revoked = 0
  for (const id of ids) {
    if (!/^sess_\w+$/.test(id)) throw new Error('The session ledger holds a line that is not a session id.')
    const session = (await call(`/sessions/${id}`)) as { status: string }
    if (session.status !== 'active') continue
    await call(`/sessions/${id}/revoke`, 'POST')
    revoked += 1
  }
  return { recorded: ids.length, revoked }
}

/** Ends every active session of every fixture user. */
export async function revokeAllFixtureSessions(
  secretKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<{ role: string; revoked: number }[]> {
  const call = clerkApi(secretKey, fetchImpl)
  const results: { role: string; revoked: number }[] = []
  for (const [role, fixture] of Object.entries(FIXTURES)) {
    const users = (await call(`/users?email_address=${encodeURIComponent(fixture.email)}`)) as { id: string }[]

    let revoked = 0
    for (const user of users) {
      // Revoked sessions leave the active list, so re-read from the top until
      // it is empty rather than paging over a list that is shrinking.
      for (;;) {
        const sessions = (await call(`/sessions?user_id=${user.id}&status=active&limit=${PAGE}`)) as { id: string }[]
        if (sessions.length === 0) break
        for (const session of sessions) {
          await call(`/sessions/${session.id}/revoke`, 'POST')
          revoked += 1
        }
      }
    }
    results.push({ role, revoked })
  }
  return results
}

async function main() {
  const key = process.env.CLERK_SECRET_KEY
  if (process.argv.includes('--all-fixtures')) {
    for (const { role, revoked } of await revokeAllFixtureSessions(key)) console.log(`${role}: revoked ${revoked}`)
    return
  }
  let ledger: string
  try {
    ledger = readFileSync(SESSION_LEDGER, 'utf8')
  } catch {
    throw new Error('No session ledger, so the sessions this run created cannot be ended.')
  }
  const { recorded, revoked } = await revokeRecordedSessions(key, ledger)
  rmSync(SESSION_LEDGER)
  console.log(`Sessions recorded: ${recorded}. Revoked: ${revoked}. Already ended: ${recorded - revoked}.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
  })
}
