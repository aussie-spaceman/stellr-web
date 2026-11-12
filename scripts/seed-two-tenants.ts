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
 *
 * --profile flow (S5 wave 7, K3): the dev canary tenant, 'dev-canary', which is
 * meant to be served (lib/testing/canary-flow-seed.ts says what it writes). The
 * default profile above is `--profile honeytoken`, unchanged.
 *
 *   npx tsx scripts/seed-two-tenants.ts --profile flow --zone <zone>                  # dry run
 *   npx tsx scripts/seed-two-tenants.ts --profile flow --zone <zone> --apply --clerk  # writes it (K7a, owner's yes)
 *   npx tsx scripts/seed-two-tenants.ts --profile flow --zone <zone> --check          # readiness reasons; exit 1 if not ready
 *   npx tsx scripts/seed-two-tenants.ts --profile flow --remove                       # dry run of the teardown
 *   npx tsx scripts/seed-two-tenants.ts --profile flow --remove --apply --clerk       # teardown (K7a rollback)
 *
 * The flow profile also refuses a live Clerk key without --clerk, APP_ENV or
 * NEXT_PUBLIC_APP_ENV prod or preview, VERCEL_ENV preview, and any database but
 * the dev project or a stack on this machine. It prints hosts, slugs and handles,
 * never emails.
 */
import * as dotenv from 'dotenv'
import * as fs from 'fs'
import * as path from 'path'
import { assertSeedTarget, clerkCreateUserBody, membershipRow, planTwoTenantSeed, type SeedUser } from '../lib/testing/two-tenant-seed'
import {
  applyCanaryFlowSeed,
  assertCanaryFlowTarget,
  canaryClerkCreateUserBody,
  canaryClerkMetadata,
  canaryReadiness,
  CANARY_REMOVAL_STEPS,
  describeCanaryFlowPlan,
  flowTargetEnvFrom,
  formatReadiness,
  planCanaryFlowSeed,
  readCanaryFacts,
  removeCanaryFlow,
  type CanaryPersona,
} from '../lib/testing/canary-flow-seed'
import { STELLR_TENANT_ID } from '../lib/tenancy/constants'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const CLERK = process.argv.includes('--clerk')
const CLERK_API = 'https://api.clerk.com/v1'
const PROFILE = flagValue('--profile') ?? 'honeytoken'
const ZONE = flagValue('--zone')
const CHECK = process.argv.includes('--check')
const REMOVE = process.argv.includes('--remove')

/** `--name value` or `--name=value`; '' when the flag has no value, undefined when absent. */
function flagValue(name: string): string | undefined {
  const args = process.argv.slice(2)
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq !== undefined) return eq.slice(name.length + 1)
  const at = args.indexOf(name)
  if (at === -1) return undefined
  const next = args[at + 1]
  return next !== undefined && !next.startsWith('--') ? next : ''
}

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
  if (PROFILE === 'flow') return mainFlow()
  if (PROFILE !== 'honeytoken') throw new Error(`unknown --profile ${PROFILE}: use honeytoken (the default) or flow`)
  if (CHECK || REMOVE || ZONE !== undefined) throw new Error('--check, --remove and --zone belong to --profile flow')
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

// ── --profile flow ──────────────────────────────────────────────────────────

/** The persona's Clerk user, created if missing; its role set either way (a merge, so other keys stay). */
async function ensureFlowClerkUser(persona: CanaryPersona): Promise<string> {
  const found = await clerk<{ id: string }[]>('GET', `/users?email_address=${encodeURIComponent(persona.email)}`)
  const id = found.length ? found[0].id : (await clerk<{ id: string }>('POST', '/users', canaryClerkCreateUserBody(persona))).id
  await clerk('PATCH', `/users/${id}/metadata`, { public_metadata: canaryClerkMetadata(persona) })
  return id
}

async function deleteFlowClerkUser(persona: CanaryPersona): Promise<'deleted' | 'absent'> {
  const found = await clerk<{ id: string }[]>('GET', `/users?email_address=${encodeURIComponent(persona.email)}`)
  if (!found.length) return 'absent'
  await clerk('DELETE', `/users/${found[0].id}`)
  return 'deleted'
}

async function mainFlow() {
  assertCanaryFlowTarget(flowTargetEnvFrom(process.env, CLERK))
  if (CHECK && (APPLY || REMOVE)) throw new Error('--check is read-only; it cannot be combined with --apply or --remove')
  const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).host

  if (REMOVE) {
    console.log(`Canary flow teardown — ${APPLY ? 'APPLY' : 'dry run'}${CLERK ? ' with Clerk users' : ''}`)
    console.log(`  target: ${target}`)
    for (const step of CANARY_REMOVAL_STEPS) console.log(`  - ${step}`)
    if (!APPLY) {
      console.log('\nDry run: nothing removed. Re-run with --apply.')
      return
    }
    // Imported only now, after dotenv and the target guard.
    // lib/deletion/execute.ts loads only inside the app (server-only), so the
    // teardown follows the registry's 'event' entity itself (canary-flow-seed.ts).
    const { supabaseServer } = await import('../lib/supabase')
    const { getEntityDef } = await import('../lib/deletion/registry')
    const { deletionPreflight } = await import('../lib/deletion/preflight')
    const { archiveEntity } = await import('../lib/deletion/archive')
    const { syncEventManagerUnassigned } = await import('../lib/authz/role-sync')
    const eventEntity = getEntityDef('event')
    if (!eventEntity) throw new Error("the deletion registry has no 'event' entity")
    const result = await removeCanaryFlow({
      db: supabaseServer(),
      eventEntity,
      deletionPreflight,
      archive: (_def, id, deletedBy) => archiveEntity(eventEntity, id, deletedBy),
      syncEventManagerUnassigned,
      deleteClerkUser: CLERK ? deleteFlowClerkUser : undefined,
      log: (line) => console.log(line),
    })
    console.log(`\nDone. Tenant ${result.tenant}.`)
    return
  }

  const plan = planCanaryFlowSeed({ zone: ZONE ?? '' })
  if (CHECK) {
    const { supabaseServer } = await import('../lib/supabase')
    const { tenantEventSender } = await import('../lib/event-emails/tenant-mail')
    const facts = await readCanaryFacts(supabaseServer(), plan)
    const lines = canaryReadiness(plan, facts, { senderOf: tenantEventSender })
    console.log(`Canary flow readiness (${target})`)
    for (const line of formatReadiness(lines)) console.log(line)
    if (lines.some((l) => !l.ok)) process.exitCode = 1
    return
  }

  console.log(`Canary flow seed — ${APPLY ? 'APPLY' : 'dry run'}${CLERK ? ' with Clerk users' : ''}`)
  console.log(`  target: ${target}`)
  for (const line of describeCanaryFlowPlan(plan)) console.log(line)
  if (!APPLY) {
    console.log('\nDry run: nothing written. Re-run with --apply.')
    return
  }
  const { supabaseServer } = await import('../lib/supabase')
  const { syncEventManagerAssigned, syncTenantAdminGranted } = await import('../lib/authz/role-sync')
  await applyCanaryFlowSeed(plan, {
    db: supabaseServer(),
    ensureClerkUser: CLERK ? ensureFlowClerkUser : undefined,
    syncEventManagerAssigned,
    syncTenantAdminGranted,
    log: (line) => console.log(line),
  })
  console.log('\nDone. Check it with --check.')
}

main().catch((e) => {
  console.error(`seed-two-tenants: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
