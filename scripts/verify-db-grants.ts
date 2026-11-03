/**
 * READ-ONLY live probe: is the database refusing anonymous RPC calls?
 * (deep review DB-N3; multi-tenancy plan S0-1)
 *
 * Calls one SECURITY DEFINER function through PostgREST with ONLY the public
 * anon key — the exact path an attacker uses (the anon key ships in every
 * browser bundle). The probe target is `survey_current_member_id`: STABLE,
 * writes nothing, returns NULL for anon. It is chosen because it is the one
 * sealed function whose call is harmless even if the revoke never applied —
 * never probe the purge/redact/claim functions this way, because a probe that
 * succeeds would run them.
 *
 *   PASS  → 401/403 whose body is Postgres 42501 "permission denied for function"
 *   FAIL  → 200 (anon can still execute definer functions)
 *   Anything else (a 401 for a bad key, say) is inconclusive, never a pass.
 *
 * Works with a legacy anon JWT or a new sb_publishable_… key. The key is read
 * through lib/supabase-keys.ts (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, falling
 * back to the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY), which also refuses an
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
import { PUBLIC_KEY_VARS, supabaseApiHeaders, supabasePublicKey } from '../lib/supabase-keys'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const PROBE_FN = 'survey_current_member_id'

function classifyProbe(status: number, body: string): 'pass' | 'fail' | 'inconclusive' {
  // A 401 also means "bad key", so only a permission error counts as refused.
  if ((status === 401 || status === 403) && /42501|permission denied/i.test(body)) return 'pass'
  if (status >= 200 && status < 300) return 'fail'
  return 'inconclusive'
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  // Read at call time: the import above runs before dotenv loads .env.local.
  const anon = supabasePublicKey()
  if (!url || !anon) {
    console.error(`❌ set NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) and ${PUBLIC_KEY_VARS}`)
    process.exit(2)
  }

  // A legacy anon key is a JWT and goes in Authorization too; a publishable
  // key is not a JWT, and sending it as a Bearer token would 401 for the wrong
  // reason. supabaseApiHeaders makes that call.
  const headers: Record<string, string> = { ...supabaseApiHeaders(anon), 'Content-Type': 'application/json' }

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${PROBE_FN}`, {
    method: 'POST',
    headers,
    body: '{}',
  })
  const body = (await res.text()).slice(0, 200)
  const verdict = classifyProbe(res.status, body)
  const host = new URL(url).host
  if (verdict === 'pass') {
    console.log(`✅ ${host}: anon refused on ${PROBE_FN} (${res.status})`)
  } else if (verdict === 'fail') {
    console.log(`❌ ${host}: anon EXECUTED ${PROBE_FN} (${res.status}) — definer functions are still anon-callable`)
    process.exit(1)
  } else {
    console.log(`⚠️  ${host}: unexpected ${res.status} — ${body}`)
    process.exit(1)
  }
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(1) })
