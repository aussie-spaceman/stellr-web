/**
 * READ-ONLY live probe: does the database refuse the public (anon) key?
 * (deep review DB-N3; multi-tenancy plan S0-1 and S0-3)
 *
 * Calls PostgREST with ONLY the publishable key, the exact path an attacker
 * uses (the key ships in every browser bundle). Two probes:
 *
 *  1. rpc  — calls one SECURITY DEFINER function, `survey_current_member_id`:
 *     STABLE, writes nothing, returns NULL for anon. It is the one sealed
 *     function whose call is harmless even if the revoke never applied. Never
 *     probe the purge/redact/claim functions this way, because a probe that
 *     succeeds would run them.
 *  2. table — reads one row of `cron_runs` (S0-3: migration
 *     s0_revoke_table_grants). It is not on the allow-list, so anon holds no
 *     grant on it, and it holds only cron job names and timings, so a probe
 *     that succeeds exposes nothing sensitive. Only `id` is selected, and the
 *     script never prints a row: on a FAIL it prints how many came back.
 *
 *   PASS  → 401/403 whose body is Postgres 42501 "permission denied"
 *   FAIL  → 2xx (anon can still execute the function or read the table)
 *   Anything else (a 401 for a bad key, say) is inconclusive, never a pass.
 *
 * Before s0_revoke_table_grants is applied the table probe FAILS: anon still
 * holds the old grant (RLS then returns no rows, which is why that is a 200).
 *
 * Uses the sb_publishable_… key. The key is read through lib/supabase-keys.ts
 * (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY only), which also refuses an
 * elevated key in the public slot.
 *
 * For the full picture run supabase/tests/security_checks.sql (zero rows = pass).
 *
 *   npx tsx scripts/verify-db-grants.ts
 *   NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… npx tsx scripts/verify-db-grants.ts   # another project
 *
 * dotenv never overrides a variable already set in the shell, so the two set
 * on the command line win over .env.local. (SUPABASE_URL, if set, still takes
 * precedence over NEXT_PUBLIC_SUPABASE_URL for the URL.)
 */

import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import { PUBLIC_KEY_VARS, supabaseApiHeaders, supabasePublicKey } from '../lib/supabase-keys'

export type Verdict = 'pass' | 'fail' | 'inconclusive'

export type Probe = {
  /** What the line in the report names. */
  label: string
  /** Path under the project URL. */
  path: string
  method: 'GET' | 'POST'
  body?: string
  /** Said on a FAIL. */
  failMessage: string
}

/** Not on the S0-3 allow-list; holds no personal data. */
export const TABLE_PROBE = 'cron_runs'
export const RPC_PROBE = 'survey_current_member_id'

export const PROBES: readonly Probe[] = [
  {
    label: `rpc ${RPC_PROBE}`,
    path: `/rest/v1/rpc/${RPC_PROBE}`,
    method: 'POST',
    body: '{}',
    failMessage: 'definer functions are still anon-callable',
  },
  {
    label: `table ${TABLE_PROBE}`,
    path: `/rest/v1/${TABLE_PROBE}?select=id&limit=1`,
    method: 'GET',
    failMessage: 'anon still holds a table grant outside the S0-3 allow-list',
  },
]

export function classifyProbe(status: number, body: string): Verdict {
  // A 401 also means "bad key", so only a permission error counts as refused.
  if ((status === 401 || status === 403) && /42501|permission denied/i.test(body)) return 'pass'
  if (status >= 200 && status < 300) return 'fail'
  return 'inconclusive'
}

/** How many rows a 2xx answer carried, without echoing any of them. */
export function rowCount(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body)
    return Array.isArray(parsed) ? `${parsed.length} row(s)` : 'a non-array body'
  } catch {
    return 'an unparsed body'
  }
}

async function main() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
  else dotenv.config()

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  // Read after dotenv has loaded .env.local.
  const anon = supabasePublicKey()
  if (!url || !anon) {
    console.error(`❌ set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ${PUBLIC_KEY_VARS}`)
    process.exit(2)
  }

  // A legacy JWT value would go in Authorization too; a publishable
  // key is not a JWT, and sending it as a Bearer token would 401 for the wrong
  // reason. supabaseApiHeaders makes that call.
  const headers: Record<string, string> = { ...supabaseApiHeaders(anon), 'Content-Type': 'application/json' }
  const base = url.replace(/\/$/, '')
  const host = new URL(url).host

  let ok = true
  for (const probe of PROBES) {
    const res = await fetch(`${base}${probe.path}`, { method: probe.method, headers, body: probe.body })
    const text = await res.text()
    const verdict = classifyProbe(res.status, text)
    if (verdict === 'pass') {
      console.log(`✅ ${host}: anon refused on ${probe.label} (${res.status})`)
    } else if (verdict === 'fail') {
      console.log(`❌ ${host}: anon allowed on ${probe.label} (${res.status}, ${rowCount(text)}) — ${probe.failMessage}`)
      ok = false
    } else {
      console.log(`⚠️  ${host}: unexpected ${res.status} on ${probe.label} — ${text.slice(0, 200)}`)
      ok = false
    }
  }
  if (!ok) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('Unexpected error:', e); process.exit(1) })
}
