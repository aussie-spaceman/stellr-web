/**
 * Two-tenant fixture: Stellr (tenant #1, US/USD) and "Canary Academy"
 * (tenant B, AU/AUD) in the S3 tables, for cross-tenant tests and honeytoken
 * probes (multi-tenant plan S2/S4; docs/SECURITY-route-manifest.md).
 *
 *   npx tsx scripts/seed-two-tenants.ts                  # dry run (default): prints the plan, writes nothing
 *   npx tsx scripts/seed-two-tenants.ts --apply          # writes the rows to the project in .env.local
 *   npx tsx scripts/seed-two-tenants.ts --apply --clerk  # also creates the Clerk users (Backend API) and the
 *                                                        # Canary tenant_admin membership
 *
 * Refuses, with no override, when NEXT_PUBLIC_SUPABASE_URL names the
 * production project, and (with --clerk) when CLERK_SECRET_KEY is not an
 * sk_test_ key. Idempotent: tenants, domains and events are upserted on their
 * natural keys, Clerk users are looked up by email before one is created, and
 * Stellr's own tenant row is never rewritten.
 *
 * Writes:
 *   tenants            Canary Academy (Stellr's row must already exist: migration 20261104100000)
 *   tenant_domains     canary-academy.localhost → Canary, stellr.localhost → Stellr (Playwright hosts)
 *   events             one fixture event per tenant (honeytoken slug for Canary)
 *   tenant_memberships the Canary admin (with --clerk)
 * Clerk users (with --clerk): stellr-participant, canary-admin,
 * canary-participant, on `+clerk_test@example.com` addresses with no password
 * (sign in with a Clerk testing token). Their members rows come from the normal
 * Clerk webhook / onboarding path, not from here.
 *
 * Prerequisites (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY,
 * the five S3 migrations applied; CLERK_SECRET_KEY (sk_test_) for --clerk.
 */
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { assertSeedTarget, clerkCreateUserBody, membershipRow, planTwoTenantSeed, type SeedUser } from '../lib/testing/two-tenant-seed'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const CLERK = process.argv.includes('--clerk')
const CLERK_API = 'https://api.clerk.com/v1'

async function clerk<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CLERK_API}${route}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Clerk ${method} ${route} → ${res.status}`)
  return (await res.json()) as T
}

async function ensureClerkUser(user: SeedUser): Promise<string> {
  const found = await clerk<{ id: string }[]>('GET', `/users?email_address=${encodeURIComponent(user.email)}`)
  if (found.length) return found[0].id
  const created = await clerk<{ id: string }>('POST', '/users', clerkCreateUserBody(user))
  return created.id
}

async function main() {
  assertSeedTarget({ supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, clerkSecretKey: process.env.CLERK_SECRET_KEY, useClerk: CLERK })
  const plan = planTwoTenantSeed()

  console.log(`Two-tenant seed — ${APPLY ? 'APPLY' : 'dry run'}${CLERK ? ' with Clerk users' : ''}`)
  console.log(`  target: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).host}`)
  console.log(`  tenants:        ${plan.tenants.map((t) => t.slug).join(', ')}`)
  console.log(`  tenant_domains: ${plan.tenant_domains.map((d) => d.host).join(', ')}`)
  console.log(`  events:         ${plan.events.map((e) => e.slug).join(', ')}`)
  console.log(`  clerk users:    ${CLERK ? plan.users.map((u) => u.handle).join(', ') : '(skipped; pass --clerk)'}`)
  if (!APPLY) {
    console.log('\nDry run: nothing written. Re-run with --apply.')
    return
  }

  // Imported only on --apply, after dotenv and the target guard.
  const { supabaseServer } = await import('../lib/supabase')
  const db = supabaseServer()

  const { data: stellr, error: stellrErr } = await db.from('tenants').select('id').eq('id', STELLR_TENANT_ID).maybeSingle()
  if (stellrErr) throw new Error(`reading tenants: ${stellrErr.message} (are the S3 migrations applied?)`)
  if (!stellr) throw new Error('Stellr tenant row missing: apply migration 20261104100000 first')

  const others = plan.tenants.filter((t) => t.id !== STELLR_TENANT_ID)
  for (const [table, rows, onConflict] of [
    ['tenants', others, 'id'],
    ['tenant_domains', plan.tenant_domains, 'host'],
    ['events', plan.events, 'slug'],
  ] as const) {
    const { error } = await db.from(table).upsert(rows as Record<string, unknown>[], { onConflict })
    if (error) throw new Error(`upsert ${table}: ${error.message}`)
    console.log(`  ✓ ${table}: ${rows.length}`)
  }

  if (CLERK) {
    for (const user of plan.users) {
      const id = await ensureClerkUser(user)
      console.log(`  ✓ clerk user ${user.handle}`)
      const row = membershipRow(user, id)
      if (!row) continue
      const { data: existing } = await db
        .from('tenant_memberships')
        .select('id')
        .eq('tenant_id', row.tenant_id as string)
        .eq('clerk_user_id', id)
        .eq('role', row.role as string)
        .maybeSingle()
      if (!existing) {
        const { error } = await db.from('tenant_memberships').insert(row)
        if (error) throw new Error(`insert tenant_memberships: ${error.message}`)
      }
      console.log(`  ✓ membership ${user.handle} (${user.tenantRole})`)
    }
  }
  console.log('\nDone.')
}

main().catch((e) => {
  console.error(`seed-two-tenants: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
