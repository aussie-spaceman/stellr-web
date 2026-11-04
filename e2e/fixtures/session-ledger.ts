import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Every Clerk session this run creates, one id per line, so the e2e job can end
 * exactly those before it uploads the report (scripts/revoke-e2e-sessions.ts).
 * Overlapping runs and anyone using the fixture users locally keep theirs.
 *
 * Under the gitignored e2e/.auth, so it never reaches git or the report. Workers
 * and retries append to the one file: a line this short is written in one go.
 */
export const SESSION_LEDGER = 'e2e/.auth/created-sessions.txt'

export function recordCreatedSession(sessionId: string): void {
  mkdirSync(dirname(SESSION_LEDGER), { recursive: true })
  appendFileSync(SESSION_LEDGER, `${sessionId}\n`)
}
