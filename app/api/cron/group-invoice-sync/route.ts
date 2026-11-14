import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { guardCron } from '@/lib/cron'
import { withCronAudit } from '@/lib/cron-audit'
import { startCronRun } from '@/lib/cron-runs'
import { partitionByTenant, runPerTenant, type TenantJob } from '@/lib/cron-tenants'
import { getEventBySlug } from '@/lib/events/repo'
import { syncGroupInvoice } from '@/lib/group-billing'
import { eventIsOver, settleShare } from '@/lib/teacher-share'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

// GET /api/cron/group-invoice-sync — runs daily (see vercel.json).
//
// After a roster change, the function that handled it waits out a quiet period
// and then updates the group's unpaid invoice. If that function is cut off, or
// Stripe refuses, the update stays due. This is the backstop that runs it.
//
// It also settles groups whose students share the teacher's cost, the day after
// their event (lib/teacher-share.ts): one daily job rather than a new cron.
//
// Per tenant (S5 B22): both passes read tenant_id with their rows and run through
// runPerTenant (lib/cron-tenants.ts). Only Stellr runs. Stellr alone is the
// runner's plain call: no read of `tenants`, the same Stripe calls and writes,
// and the same result keys, with failures under the same labels. Every other
// tenant's due rows are held until S9 brings priced tenant events (A7 refuses
// them until then): they never reach Stripe, stay due for a later run, and are
// counted in `tenantHeld` and `share_tenantHeld`. Tenant comes from the rows
// only, never from a request header or host.
//
// Stellr's reads take Stellr's rows (NULL counts as Stellr), so a backlog of held
// rows can never fill the 50 a pass takes and starve Stellr's.
//
// The sweeps here stand in for syncDueGroupInvoices (lib/group-billing.ts) and
// settleDueShares (lib/teacher-share.ts), adding the tenant column, the deadline
// and the abort check. test/cron-per-tenant-b22.test.ts proves the Stripe calls
// and writes match theirs on a Stellr fixture.

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Rows each pass takes per run, as before. */
const PASS_LIMIT = 50

/** Stop starting registrations this long into the run, clear of maxDuration (300 s). */
const RUN_BUDGET_MS = 270_000

type Db = SupabaseClient
type Pass = Record<string, number>
type Due = { id: string; tenant_id: string | null }
type ShareDue = Due & { event_slug: string }

/** PostgREST `or` value for this tenant's rows: Stellr's own and those not yet stamped (NULL counts as Stellr), or exactly another tenant's. */
function ownRows(tenantId: string): string {
  return tenantId === STELLR_TENANT_ID ? STELLR_OR_NULL : `tenant_id.eq.${tenantId}`
}

const invoiceSyncDue = (db: Db, columns: string) =>
  db.from('registrations').select(columns).not('invoice_sync_due_at', 'is', null).lte('invoice_sync_due_at', new Date().toISOString())

const shareDue = (db: Db, columns: string) =>
  db.from('registrations').select(columns).not('share_estimate', 'is', null).is('share_settled_at', null).neq('status', 'withdrawn')

/** The rows the read returned that are this tenant's; any other is left alone. */
function mine<T extends Due>(rows: readonly T[], tenantId: string): T[] {
  return partitionByTenant(rows).get(tenantId) ?? []
}

/** Unpaid group invoices whose update is due, as syncDueGroupInvoices does, for one tenant. */
async function syncDue(db: Db, stripe: Stripe, job: TenantJob, stop: () => boolean): Promise<Pass> {
  const { data, error } = await invoiceSyncDue(db, 'id, tenant_id').or(ownRows(job.tenant.id)).limit(PASS_LIMIT)
  if (error) throw new Error(error.message)
  const tally: Pass = {}
  for (const { id } of mine((data ?? []) as unknown as Due[], job.tenant.id)) {
    if (stop()) {
      tally.deferred = (tally.deferred ?? 0) + 1
      continue
    }
    const result = await syncGroupInvoice(db, stripe, id)
    tally[result] = (tally[result] ?? 0) + 1
  }
  return tally
}

/** Sharing groups whose event is over, as settleDueShares does, for one tenant. */
async function settleDue(db: Db, stripe: Stripe, job: TenantJob, stop: () => boolean): Promise<Pass> {
  const { data, error } = await shareDue(db, 'id, event_slug, tenant_id').or(ownRows(job.tenant.id)).limit(PASS_LIMIT)
  if (error) throw new Error(error.message)
  const tally: Pass = { settled: 0, not_due: 0, refunds: 0, refunds_failed: 0 }
  const events = new Map<string, boolean>()
  for (const row of mine((data ?? []) as unknown as ShareDue[], job.tenant.id)) {
    if (stop()) {
      tally.deferred = (tally.deferred ?? 0) + 1
      continue
    }
    if (!events.has(row.event_slug)) {
      const event = (await getEventBySlug(row.event_slug).catch(() => null)) as { date?: string; endDate?: string } | null
      events.set(row.event_slug, eventIsOver(event))
    }
    if (!events.get(row.event_slug)) { tally.not_due++; continue }
    const out = await settleShare(db, stripe, row.id)
    if (!out) continue
    tally.settled++
    tally.refunds += out.refunded
    tally.refunds_failed += out.failed
  }
  return tally
}

/**
 * How many due rows other tenants have waiting: another tenant's id only, since
 * NULL is Stellr's. A failed read is recorded and counts none, so Stellr's result
 * still lands.
 */
async function heldCount(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  fail: (detail: string) => void,
): Promise<number> {
  const { data, error } = await query
  if (error) {
    fail(error.message)
    return 0
  }
  let held = 0
  for (const [tenantId, rows] of partitionByTenant((data ?? []) as Due[])) if (tenantId !== STELLR_TENANT_ID) held += rows.length
  return held
}

export const GET = withCronAudit('group-invoice-sync', async (req: NextRequest) => {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const started = Date.now()
  const db = supabaseServer()
  const run = await startCronRun(db, 'group-invoice-sync')
  try {
    // Only Stellr runs until S9. It always has a turn, so a quiet run still
    // writes the share tally it always has.
    const tenantIds = [STELLR_TENANT_ID]
    const stellrOnly = tenantIds.length === 1
    const stellrFailure: unknown[] = []
    const outcome = await runPerTenant<{ tally: Pass; shares: Pass }>(db, run, {
      job: 'group-invoice-sync',
      deadline: started + RUN_BUDGET_MS,
      tenantIds,
      fn: async (job) => {
        const stop = () => job.signal.aborted || Date.now() > job.deadline
        let tally: Pass
        try {
          tally = await syncDue(db, stripe, job, stop)
        } catch (err) {
          // Stellr alone: a failed sweep ends the run as it always has (the 500
          // below), rather than becoming a recorded tenant failure.
          if (!stellrOnly) throw err
          stellrFailure.push(err)
          return { tally: {}, shares: {} }
        }
        let shares: Pass = {}
        try {
          shares = await settleDue(db, stripe, job, stop)
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e)
          console.error('[cron:group-invoice-sync] share settlement failed:', detail)
          job.fail('share-settle', detail)
        }
        return { tally, shares }
      },
    })
    if (stellrFailure.length) throw stellrFailure[0]

    const { tally, shares } = outcome.results.get(STELLR_TENANT_ID) ?? { tally: {}, shares: {} }
    const heldFailed = (where: string) => (detail: string) => {
      console.error(`[cron:group-invoice-sync] ${where} read failed:`, detail)
      run.fail(where, detail)
    }
    const tenantHeld = await heldCount(
      invoiceSyncDue(db, 'id, tenant_id').not('tenant_id', 'is', null).neq('tenant_id', STELLR_TENANT_ID),
      heldFailed('tenant-held'),
    )
    const shareHeld = await heldCount(
      shareDue(db, 'id, tenant_id').not('tenant_id', 'is', null).neq('tenant_id', STELLR_TENANT_ID),
      heldFailed('share-tenant-held'),
    )

    // tenantHeld, share_tenantHeld and the ledger are absent from a Stellr-only run with nothing held.
    const all = {
      ...tally,
      ...Object.fromEntries(Object.entries(shares).map(([k, v]) => [`share_${k}`, v])),
      ...(tenantHeld ? { tenantHeld } : {}),
      ...(shareHeld ? { share_tenantHeld: shareHeld } : {}),
      ...outcome.ledger,
    }
    await run.finish(all)
    return NextResponse.json(all)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[cron:group-invoice-sync] failed:', detail)
    run.fail('sync', detail)
    await run.finish({})
    return NextResponse.json({ error: detail }, { status: 500 })
  }
})
