import type { SupabaseClient } from '@supabase/supabase-js'
import {
  pickTemplate,
  spareCount,
  placementFromLine,
  type BadgeAudience,
  type BadgeFormat,
  type BadgePlacement,
} from '@/lib/badge-layout'
import { prepareBadgeArtwork, wantsLightInk, type PreparedBadgeArtwork } from '@/lib/badge-artwork'
import { downloadArtwork } from '@/lib/event-certificates'
import type { Badge, BadgeDesign, BadgePerson } from '@/lib/event-pdf'
import { checkInCodeLink } from '@/lib/check-in-codes'
import type { ArtworkTheme } from '@/lib/artwork-theme'

// ── Event name badges: database side ─────────────────────────────────────────
// Templates (event_badge_templates: one artwork per format per audience, over
// default_badge_templates: the theme's everyone/mentors defaults), who gets a
// badge, and which template each badge uses. Layout and the rule finder:
// lib/badge-layout.ts. Mirrors lib/event-certificates.ts.

export interface BadgeTemplate {
  id: string
  format: BadgeFormat
  audience: BadgeAudience
  company_id: string | null
  artwork_path: string
  name_x: number | null
  name_y: number | null
  name_max_width: number | null
  name_size: number | null
  updated_at: string
  /** The event's own upload, or its theme's default (lib/artwork-defaults.ts). */
  source: 'event' | 'default'
}

const COLUMNS = 'id, format, audience, company_id, artwork_path, name_x, name_y, name_max_width, name_size, updated_at'
// Defaults have no company: companies belong to one event.
const DEFAULT_COLUMNS = 'id, format, audience, artwork_path, name_x, name_y, name_max_width, name_size, updated_at'

// numeric columns arrive as strings from PostgREST.
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
function normalise(row: BadgeTemplate, source: BadgeTemplate['source']): BadgeTemplate {
  return {
    ...row,
    company_id: row.company_id ?? null,
    name_x: num(row.name_x),
    name_y: num(row.name_y),
    name_max_width: num(row.name_max_width),
    name_size: num(row.name_size),
    source,
  }
}

/** The event's own templates. */
export async function loadBadgeTemplates(db: SupabaseClient, slug: string, format?: BadgeFormat): Promise<BadgeTemplate[]> {
  let q = db.from('event_badge_templates').select(COLUMNS).eq('event_slug', slug)
  if (format) q = q.eq('format', format)
  const { data, error } = await q
  if (error) throw new Error(`[event-badges] templates: ${error.message}`)
  return ((data ?? []) as BadgeTemplate[]).map((r) => normalise(r, 'event'))
}

export async function loadBadgeTemplate(db: SupabaseClient, slug: string, id: string): Promise<BadgeTemplate | null> {
  const { data } = await db.from('event_badge_templates').select(COLUMNS).eq('event_slug', slug).eq('id', id).maybeSingle()
  return data ? normalise(data as BadgeTemplate, 'event') : null
}

/** A theme's defaults: everyone and mentors, per format. */
export async function loadDefaultBadgeTemplates(db: SupabaseClient, theme: ArtworkTheme, format?: BadgeFormat): Promise<BadgeTemplate[]> {
  let q = db.from('default_badge_templates').select(DEFAULT_COLUMNS).eq('theme', theme)
  if (format) q = q.eq('format', format)
  const { data, error } = await q
  if (error) throw new Error(`[event-badges] default templates: ${error.message}`)
  return ((data ?? []) as BadgeTemplate[]).map((r) => normalise(r, 'default'))
}

export async function loadDefaultBadgeTemplate(db: SupabaseClient, theme: ArtworkTheme, id: string): Promise<BadgeTemplate | null> {
  const { data } = await db.from('default_badge_templates').select(DEFAULT_COLUMNS).eq('theme', theme).eq('id', id).maybeSingle()
  return data ? normalise(data as BadgeTemplate, 'default') : null
}

/**
 * What prints: the event's own templates, with each everyone/mentors slot it
 * lacks (per format) filled from its theme's defaults. pickTemplate then
 * chooses among them as before, so an event's own mentors background still
 * beats its company one, and a default only ever stands in for a missing slot.
 */
export function effectiveBadgeTemplates(own: BadgeTemplate[], defaults: BadgeTemplate[]): BadgeTemplate[] {
  const filled = defaults.filter(
    (d) => !own.some((t) => t.format === d.format && t.audience === d.audience && t.company_id === null),
  )
  return [...own, ...filled]
}

export interface EventCompany {
  id: string
  number: number
  name: string | null
}

export async function loadCompanies(db: SupabaseClient, slug: string): Promise<EventCompany[]> {
  const { data } = await db.from('event_companies').select('id, number, name').eq('event_slug', slug).order('number')
  return (data ?? []) as EventCompany[]
}

export function companyLabel(c: Pick<EventCompany, 'number' | 'name'>): string {
  return c.name ? `Company ${c.number}: ${c.name}` : `Company ${c.number}`
}

/** The stored placement, or — for a row never positioned — one from the rule. */
export function placementOf(t: BadgeTemplate, prepared: Pick<PreparedBadgeArtwork, 'line'>): BadgePlacement {
  if (t.name_x !== null && t.name_y !== null && t.name_max_width !== null && t.name_size !== null) {
    return { nameX: t.name_x, nameY: t.name_y, nameMaxWidth: t.name_max_width, nameSize: t.name_size }
  }
  return placementFromLine(prepared.line, t.format)
}

/** Placement overrides from a query string (the admin's unsaved sliders). */
export function placementFromParams(base: BadgePlacement, params: URLSearchParams): BadgePlacement {
  const n = (k: string, min: number, max: number, fallback: number) => {
    const v = Number(params.get(k))
    return params.has(k) && Number.isFinite(v) && v >= min && v <= max ? v : fallback
  }
  return {
    nameX: n('name_x', 0.01, 0.99, base.nameX),
    nameY: n('name_y', 0.01, 0.99, base.nameY),
    nameMaxWidth: n('name_max_width', 0.05, 1, base.nameMaxWidth),
    nameSize: n('name_size', 6, 72, base.nameSize),
  }
}

/** Download and prepare a template's artwork. null when it cannot be read. */
export async function prepareTemplate(db: SupabaseClient, t: BadgeTemplate): Promise<PreparedBadgeArtwork | null> {
  const artwork = await downloadArtwork(db, t.artwork_path)
  if (!artwork) return null
  try {
    return await prepareBadgeArtwork(artwork, t.format)
  } catch (err) {
    console.error('[event-badges] artwork prep failed:', t.artwork_path, err)
    return null
  }
}

/**
 * For the admin panel: rows never positioned (carried over from event_settings,
 * and the 5392 default made from the 8395 art) get the position the renderer
 * will use, found from the artwork's rule.
 */
export async function fillPlacements(db: SupabaseClient, templates: BadgeTemplate[]): Promise<BadgeTemplate[]> {
  for (const t of templates) {
    if (t.name_x !== null && t.name_y !== null && t.name_max_width !== null && t.name_size !== null) continue
    const prepared = await prepareTemplate(db, t)
    if (!prepared) continue
    const p = placementOf(t, prepared)
    Object.assign(t, { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize })
  }
  return templates
}

export function designOf(t: BadgeTemplate, prepared: PreparedBadgeArtwork, placement = placementOf(t, prepared)): BadgeDesign {
  return {
    key: t.id,
    artwork: prepared,
    placement,
    lightInk: wantsLightInk(prepared.analysis, placement, t.format),
  }
}

const ROLE_LABELS: Record<string, string> = {
  participant: 'Student',
  school_student_manager: 'Student Manager',
  teacher: 'Teacher',
  mentor: 'Mentor',
  parent: 'Parent',
}

type Named = { first_name: string | null; last_name: string | null }

export interface BadgeHolder extends BadgePerson {
  companyId: string | null
  mentor: boolean
}

/**
 * 'school': each school group's badges together (then surname), so a group's
 * packet comes off the printer in one run and goes to its teacher at check-in.
 * Registrations on their own sort by their own school; volunteer mentors last.
 */
export type BadgeOrder = 'surname' | 'school'

export const isBadgeOrder = (v: unknown): v is BadgeOrder => v === 'surname' || v === 'school'

/**
 * Everyone who gets a badge: each registered participant, and each active
 * volunteer mentor assigned to the event (volunteers are assigned to the
 * event's container, not registered — see ../volunteers), sorted by surname or
 * by school. With `codes`, each participant's badge carries their check-in code
 * (lib/check-in-codes.ts); volunteers aren't registered, so theirs don't.
 */
export async function loadBadgeHolders(
  db: SupabaseClient,
  slug: string,
  opts: { order?: BadgeOrder; codes?: boolean } = {},
): Promise<BadgeHolder[]> {
  const [{ data: regs }, { data: container }] = await Promise.all([
    db
      .from('registrations')
      .select('id, type, group_name, school_name, participants(id, member_id, first_name, last_name, event_role, school_name, company_id, event_companies(number, name))')
      .eq('event_slug', slug)
      .neq('status', 'withdrawn'),
    db
      .from('mentoring_cohorts')
      .select('id')
      .eq('container_type', 'event_participation')
      .is('parent_container_id', null)
      .eq('campaign_ref', slug)
      .maybeSingle(),
  ])

  // A group's members share its school, so they print together even when a
  // student's own school field says something slightly different.
  const participants = (regs ?? []).flatMap((r) =>
    ((r.participants as Record<string, unknown>[]) ?? []).map(
      (p): Record<string, unknown> & { school: string } => ({
        ...p,
        school: (r.type !== 'individual' ? (r.group_name as string | null) || (r.school_name as string | null) : null) || (p.school_name as string | null) || '',
      })
    )
  )
  const bySchool = opts.order === 'school'
  type Sortable = BadgeHolder & { sortSchool: string; sortName: string }
  const holders: Sortable[] = participants.map((p) => {
    const company = p.event_companies as { number: number; name: string | null } | null
    const role = ROLE_LABELS[p.event_role as string] ?? 'Participant'
    return {
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
      subtitle: company ? (company.name ?? `Company ${company.number}`) : role,
      companyId: (p.company_id as string | null) ?? null,
      mentor: p.event_role === 'mentor',
      qr: opts.codes ? checkInCodeLink(slug, 'p', p.id as string) : null,
      sortSchool: p.school,
      sortName: `${p.last_name} ${p.first_name}`,
    }
  })

  if (container?.id) {
    const { data: volunteers } = await db
      .from('cohort_members')
      .select('member_id, members(first_name, last_name)')
      .eq('cohort_id', container.id)
      .eq('relationship', 'volunteer')
      .eq('status', 'active')
    // A volunteer who also registered already has a badge.
    const registered = new Set(participants.map((p) => p.member_id).filter(Boolean))
    for (const v of volunteers ?? []) {
      if (registered.has(v.member_id)) continue
      const m = (Array.isArray(v.members) ? v.members[0] : v.members) as Named | null
      if (!m) continue
      holders.push({
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        subtitle: 'Mentor',
        companyId: null,
        mentor: true,
        sortSchool: '',
        sortName: `${m.last_name} ${m.first_name}`,
      })
    }
  }

  // By school: volunteer mentors (no school) after every school, then by name.
  const rank = (h: Sortable) => (h.mentor && !h.sortSchool ? 1 : 0)
  holders.sort(
    (a, b) =>
      (bySchool ? rank(a) - rank(b) || a.sortSchool.localeCompare(b.sortSchool, 'en', { sensitivity: 'base' }) : 0) ||
      a.sortName.localeCompare(b.sortName)
  )
  return holders.map(({ sortSchool: _s, sortName: _n, ...h }) => h) // eslint-disable-line @typescript-eslint/no-unused-vars
}

/**
 * Every holder with the design of the most specific template they have (pass
 * effectiveBadgeTemplates, so defaults stand in). With `spares`, blank badges
 * follow on the Everyone background (plain without one): enough to fill the
 * last sheet and one sheet more (spareCount).
 */
export async function resolveBadges(
  db: SupabaseClient,
  holders: BadgeHolder[],
  templates: BadgeTemplate[],
  opts: { spares?: BadgeFormat } = {},
): Promise<Badge[]> {
  const refs = templates.map((t) => ({ t, audience: t.audience, companyId: t.company_id }))
  const designs = new Map<string, BadgeDesign | null>()
  async function designFor(who: { companyId: string | null; mentor: boolean }): Promise<BadgeDesign | null> {
    const ref = pickTemplate(refs, who)
    if (!ref) return null
    if (!designs.has(ref.t.id)) {
      const prepared = await prepareTemplate(db, ref.t)
      designs.set(ref.t.id, prepared ? designOf(ref.t, prepared) : null)
    }
    return designs.get(ref.t.id) ?? null
  }

  const out: Badge[] = []
  for (const h of holders) out.push({ person: h, design: await designFor(h) })

  if (opts.spares) {
    const design = await designFor({ companyId: null, mentor: false })
    const blank: BadgePerson = { firstName: '', lastName: '', subtitle: '' }
    for (let i = spareCount(holders.length, opts.spares); i > 0; i--) out.push({ person: blank, design })
  }
  return out
}
