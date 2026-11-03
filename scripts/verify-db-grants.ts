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
 * Works with a legacy anon JWT or a new sb_publishable_… key.
 *
 * For the full picture run supabase/tests/security_checks.sql (zero rows = pass).
 *
 *   npx tsx scripts/verify-db-grants.ts
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… npx tsx scripts/verify-db-grants.ts   # another project
 */

import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'

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
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    console.error('❌ set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY)')
    process.exit(2)
  }

  // A legacy anon key is a JWT and goes in Authorization too; a publishable
  // key is not a JWT, and sending it as a Bearer token would 401 for the wrong reason.
  const headers: Record<string, string> = { apikey: anon, 'Content-Type': 'application/json' }
  if (anon.startsWith('eyJ')) headers.Authorization = `Bearer ${anon}`

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
