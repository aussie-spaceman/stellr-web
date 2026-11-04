/**
 * Verify the platform audit log's hash chains (public.platform_audit_events,
 * multi-tenancy plan S4). Read-only: it never writes.
 *
 *   npx tsx scripts/verify-audit-chain.ts                     # every chain
 *   npx tsx scripts/verify-audit-chain.ts --tenant <uuid>     # one tenant's chain
 *   npx tsx scripts/verify-audit-chain.ts --platform          # the platform chain only
 *   npx tsx scripts/verify-audit-chain.ts --heads > heads.json        # also print every chain head as JSON
 *   npx tsx scripts/verify-audit-chain.ts --expect heads.json         # also check heads recorded earlier
 *
 * Each chain is recomputed here, outside the database (lib/audit/platform.ts
 * verifyChain), so a replaced verify function in the database cannot hide a
 * break. Two kinds of tampering are invisible from inside the database:
 * removing the newest rows of a chain, and rewriting a whole chain with fresh
 * hashes. Recording the heads (--heads) somewhere the database owner cannot
 * edit, and checking them later (--expect), catches both.
 * docs/PLATFORM-AUDIT.md.
 *
 * Exit codes: 0 every chain intact; 1 a chain is broken or a recorded head no
 * longer matches; 2 the check could not run (configuration or read error).
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY.
 * Migration 20261104300000 applied.
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import type { RecordedHead } from '../lib/audit/platform'

// lib/audit/platform pulls in lib/app-errors → lib/email, which reads env at
// module scope, so the libraries are imported only after .env.local is loaded.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<number> {
  const tenant = argValue('--tenant')
  const platformOnly = process.argv.includes('--platform')
  const printHeads = process.argv.includes('--heads')
  const expectFile = argValue('--expect')
  if (tenant && !UUID.test(tenant)) {
    console.error('--tenant takes a tenant id (uuid).')
    return 2
  }

  const { supabaseServer } = await import('../lib/supabase')
  const { verifyChain, checkRecordedHeads } = await import('../lib/audit/platform')
  const db = supabaseServer()
  let chains: (string | null)[]
  if (tenant) chains = [tenant]
  else if (platformOnly) chains = [null]
  else {
    const { data, error } = await db.rpc('platform_audit_heads')
    if (error) throw new Error(`could not list chains: ${error.message}`)
    chains = ((data ?? []) as { tenant_id: string | null }[]).map((h) => h.tenant_id)
    if (!chains.includes(null)) chains.push(null)
  }

  let broken = 0
  const heads: RecordedHead[] = []
  for (const t of chains) {
    const res = await verifyChain(t, { db })
    const label = t ?? 'platform'
    if (res.ok) {
      console.error(`✓ ${label}: ${res.checked} row(s), head ${res.head.seq}`)
      if (res.head.hash) heads.push({ tenantId: t, seq: res.head.seq, hash: res.head.hash })
    } else {
      broken++
      console.error(`✗ ${label}: broken at chain_seq ${res.firstBad!.seq} (row id ${res.firstBad!.id}): ${res.firstBad!.problem}`)
    }
  }

  if (expectFile) {
    const recorded = JSON.parse(fs.readFileSync(expectFile, 'utf8')) as RecordedHead[]
    const scoped = recorded.filter((h) => (tenant ? h.tenantId === tenant : platformOnly ? h.tenantId === null : true))
    const { ok, problems } = await checkRecordedHeads(scoped, { db })
    for (const p of problems) console.error(`✗ ${p}`)
    if (!ok) broken++
    else console.error(`✓ ${scoped.length} recorded head(s) still match`)
  }

  if (printHeads) console.log(JSON.stringify(heads, null, 2))
  return broken ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('verify-audit-chain could not run:', err instanceof Error ? err.message : err)
    process.exit(2)
  })
