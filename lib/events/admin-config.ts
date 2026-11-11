// Events admin configuration: the first area that reads through tenantDb (multi-tenancy
// plan S5, C18). The queries behind events/[slug]/{companies,offerings,merch/commit}, moved
// here from the routes, which test/route-manifest.test.ts holds off a direct .from() now
// that they are tenant_staff.
//
// The 'events-config' area (lib/tenancy/area-switch.ts) covers an event's companies: the
// list, the count and a company's name. Each keeps today's supabase-js query as its
// service path, unchanged, beside a tenantDb path written to return the same rows:
//
//   service  (the default: TENANT_DB_AREAS unset, or TENANT_DB_ENABLED not 'true')
//            today's query, exactly as before. tenantDb is not built, so nothing loads
//            the Postgres client and no connection opens
//   shadow   today's query answers; a sampled share of the list reads also runs the
//            tenantDb read after the response, read-only, and records a difference by
//            uuid and count only. Writes take the service path alone
//   tenant   the tenantDb read or write answers, pinned to the caller's tenant, under
//            the tenant row level security policies: another tenant's event reads as
//            empty, and a write naming it is refused by the database
//
// The tenant comes from the caller's own scope (requireEventRoute's tenantId), never
// from request input. Every caller has already placed the event in that scope.
//
// Everything else here stays on the service-role client: the participant moves (whose
// columns tenant_app writes per column grant, Lane A's to settle; until then a move is
// confined by findEventParticipant and findEventCompany alone, which the route runs
// before updateEventParticipant, and test/events-admin-config-c18.test.ts holds that
// for a tenant's staff) and Stellr's store
// (offerings and the merch batch), which a tenant's staff cannot reach (the routes answer
// refuseOutsideStellr first) and which take a StellrOnlyDb for that reason.
import type { SupabaseClient } from '@supabase/supabase-js'
import { readArea, writeArea } from '@/lib/tenancy/area-switch'
import type { TenantDb } from '@/lib/tenancy/db'
import type { StellrOnlyDb } from '@/lib/events/admin-records'

/** The area name in TENANT_DB_AREAS. */
export const EVENTS_CONFIG_AREA = 'events-config' as const

/** A failed read on the service path; the route answers it as today's 500. */
export class EventConfigReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EventConfigReadError'
  }
}

/** One company row as the admin screen reads it: supabase-js's embedded count shape. */
export interface EventCompanyRow {
  id: string
  number: number
  name: string | null
  participants: { count: number }[]
}

// ── Companies: through the area switch ──────────────────────────────────────

/** The tenantDb read: an event's companies with a participant count each, in number order. */
export async function tenantEventCompanies(db: TenantDb, slug: string): Promise<EventCompanyRow[]> {
  const rows = await db.sql<{ id: string; number: number; name: string | null; participants: unknown }>`
    SELECT c.id::text AS id, c.number, c.name,
      json_build_array(json_build_object('count',
        (SELECT count(*) FROM public.participants p WHERE p.company_id = c.id))) AS participants
    FROM public.event_companies c
    WHERE c.event_slug = ${slug}
    ORDER BY c.number`
  return rows.map((r) => ({ id: r.id, number: r.number, name: r.name, participants: asCounts(r.participants) }))
}

/** A json column, whether the driver parsed it or handed back its text. */
function asCounts(value: unknown): { count: number }[] {
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!Array.isArray(parsed)) return []
  return parsed.map((c) => ({ count: Number((c as { count?: unknown } | null)?.count ?? 0) }))
}

/**
 * GET companies. Service: today's query, and its error throws EventConfigReadError so the
 * route answers today's 500. Tenant and shadow: see the file header.
 */
export function loadEventCompanies(db: SupabaseClient, tenantId: string, slug: string): Promise<EventCompanyRow[]> {
  return readArea<EventCompanyRow[], EventCompanyRow>(EVENTS_CONFIG_AREA, {
    tenantId,
    label: 'GET /api/admin/events/[slug]/companies',
    service: async () => {
      const { data, error } = await db
        .from('event_companies')
        .select('id, number, name, participants(count)')
        .eq('event_slug', slug)
        .order('number')
      if (error) throw new EventConfigReadError('event_companies read failed')
      return (data ?? []) as unknown as EventCompanyRow[]
    },
    tenant: (tdb) => tenantEventCompanies(tdb, slug),
  })
}

/**
 * The tenantDb write behind PUT companies: companies 1..count exist, any above count go
 * (participants.company_id nulls through ON DELETE SET NULL), in one transaction. Throws
 * on any refusal, including the policies' refusal of another tenant's event.
 */
export async function tenantSetCompanyCount(db: TenantDb, slug: string, count: number): Promise<void> {
  await db.transaction(async (q) => {
    await q.sql`
      INSERT INTO public.event_companies (event_slug, number)
      SELECT ${slug}::text, n FROM generate_series(1, ${count}::int) AS n
      ON CONFLICT (event_slug, number) DO NOTHING`
    await q.sql`DELETE FROM public.event_companies WHERE event_slug = ${slug} AND number > ${count}::int`
  })
}

/** The settings row's company count. Its own transaction: today's route ignores this write's failure. */
export async function tenantSetSettingsCompanyCount(db: TenantDb, slug: string, count: number): Promise<void> {
  await db.sql`
    INSERT INTO public.event_settings (event_slug, company_count) VALUES (${slug}::text, ${count}::int)
    ON CONFLICT (event_slug) DO UPDATE SET company_count = EXCLUDED.company_count`
}

/**
 * PUT companies: true when the companies were set. The settings row's count is written
 * after, and its failure ignored, as today. Service: today's three statements.
 */
export function setEventCompanyCount(db: SupabaseClient, tenantId: string, slug: string, count: number): Promise<boolean> {
  return writeArea(EVENTS_CONFIG_AREA, {
    tenantId,
    service: async () => {
      const rows = Array.from({ length: count }, (_, i) => ({ event_slug: slug, number: i + 1 }))
      const { error: upsertError } = await db
        .from('event_companies')
        .upsert(rows, { onConflict: 'event_slug,number', ignoreDuplicates: true })
      if (upsertError) return false
      const { error: deleteError } = await db.from('event_companies').delete().eq('event_slug', slug).gt('number', count)
      if (deleteError) return false
      await db.from('event_settings').upsert({ event_slug: slug, company_count: count }, { onConflict: 'event_slug' })
      return true
    },
    tenant: async (tdb) => {
      try {
        await tenantSetCompanyCount(tdb, slug, count)
      } catch (err) {
        console.error('[events-config] company count write refused:', codeOf(err))
        return false
      }
      await tenantSetSettingsCompanyCount(tdb, slug, count).catch((err) => {
        console.error('[events-config] settings count write failed:', codeOf(err))
      })
      return true
    },
  })
}

/** The tenantDb write behind rename: the company of this event with this id, if the tenant can see it. */
export async function tenantRenameCompany(db: TenantDb, slug: string, companyId: string, name: string | null): Promise<void> {
  await db.sql`
    UPDATE public.event_companies SET name = ${name}
    WHERE id = ${companyId}::uuid AND event_slug = ${slug}`
}

/**
 * POST companies { action: 'rename' }: true unless the write failed. Like today's update,
 * an id that matches nothing in this event changes nothing and is not an error.
 */
export function renameEventCompany(
  db: SupabaseClient,
  tenantId: string,
  slug: string,
  companyId: string,
  name: string | null,
): Promise<boolean> {
  return writeArea(EVENTS_CONFIG_AREA, {
    tenantId,
    service: async () => {
      const { error } = await db.from('event_companies').update({ name }).eq('id', companyId).eq('event_slug', slug)
      return !error
    },
    tenant: async (tdb) => {
      try {
        await tenantRenameCompany(tdb, slug, companyId, name)
        return true
      } catch (err) {
        console.error('[events-config] company rename refused:', codeOf(err))
        return false
      }
    },
  })
}

/** A SQLSTATE or an error class name for the log, never the message (it can carry values). */
function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code
  return err instanceof Error && /^[A-Za-z0-9_]{1,40}$/.test(err.name) ? err.name : 'unknown'
}

// ── Companies: service path only ────────────────────────────────────────────
// Placement on a participant row, by id, confined to the event first (deep review AUTH-3).

/** This event's participant with this id, through its registration, or null. */
export async function findEventParticipant(db: SupabaseClient, slug: string, participantId: string): Promise<{ id: string } | null> {
  const { data } = await db
    .from('participants')
    .select('id, registrations!inner(event_slug)')
    .eq('id', participantId)
    .eq('registrations.event_slug', slug)
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/** This event's company with this id, or null. */
export async function findEventCompany(db: SupabaseClient, slug: string, companyId: unknown): Promise<{ id: string } | null> {
  const { data } = await db.from('event_companies').select('id').eq('id', companyId).eq('event_slug', slug).maybeSingle()
  return (data as { id: string } | null) ?? null
}

/** Write a participant's placement or override fields. The caller confined the id to its event. */
export async function updateEventParticipant(db: SupabaseClient, participantId: string, fields: Record<string, unknown>) {
  return db.from('participants').update(fields).eq('id', participantId)
}

/** When this participant submitted a team profile, if they have. */
export async function teamProfileSubmittedAt(db: SupabaseClient, participantId: string): Promise<string | null> {
  const { data: profile } = await db.from('team_profiles').select('submitted_at').eq('participant_id', participantId).maybeSingle()
  return (profile?.submitted_at as string | null | undefined) ?? null
}

// ── Offerings and the merch batch: Stellr's store, service path only ────────

/** The event's store offerings, with each variant and product, and the active products to add from. */
export async function loadEventOfferings(db: StellrOnlyDb, slug: string) {
  const [{ data: offs }, { data: products }] = await Promise.all([
    db
      .from('event_store_offerings')
      .select('id, treatment, variant:store_variants(id, sku, label, product:store_products(id, name))')
      .eq('event_slug', slug)
      .order('treatment'),
    db.from('store_products').select('id, name, variants:store_variants(id, label, active)').eq('status', 'active').order('name'),
  ])
  return { offs, products }
}

export async function addEventOffering(db: StellrOnlyDb, slug: string, variantId: unknown, treatment: 'included' | 'addon') {
  return db.from('event_store_offerings').insert({ event_slug: slug, variant_id: variantId, treatment })
}

export async function removeEventOffering(db: StellrOnlyDb, slug: string, id: string) {
  return db.from('event_store_offerings').delete().eq('id', id).eq('event_slug', slug)
}

/** The member record of a signed-in Clerk user, for who committed a merch batch (best-effort). */
export async function memberIdForClerkUser(db: StellrOnlyDb, clerkUserId: string): Promise<string | null> {
  const { data: m } = await db.from('members').select('id').eq('clerk_user_id', clerkUserId).maybeSingle()
  return (m as { id?: string } | null)?.id ?? null
}
