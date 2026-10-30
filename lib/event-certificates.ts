import type { SupabaseClient } from '@supabase/supabase-js'
import { RESOURCES_BUCKET } from '@/lib/community'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import { DEFAULT_NAME_PLACEMENT, type Artwork, type NamePlacement } from '@/lib/event-pdf'
import { AWARD_TYPES, isAssignedAwardType, isAwardType, type AssignedAwardType, type AwardType } from '@/lib/event-awards'
import { eventsIssuedOn } from '@/lib/artwork-defaults'
import type { ArtworkTheme } from '@/lib/artwork-theme'

// ── Event certificates + awards: database side ───────────────────────────────
// Templates (one artwork per award: the event's own upload, else its theme's
// default), the event's students, and the judged award assignments. Shared by
// the admin certificate/award routes and the member credential download.
// Catalogue and rules: lib/event-awards.ts.

export interface CertificateTemplate {
  award_type: AwardType
  artwork_path: string
  name_y: number
  name_max_width: number
  name_size: number
  updated_at: string
  /** The event's own upload, or its theme's default (lib/artwork-defaults.ts). */
  source: 'event' | 'default'
}

export type TemplateSet = Record<AwardType, CertificateTemplate | null>

const TEMPLATE_COLUMNS = 'award_type, artwork_path, name_y, name_max_width, name_size, updated_at'

const emptySet = () => Object.fromEntries(AWARD_TYPES.map((t) => [t, null])) as TemplateSet

function toSet(rows: unknown[] | null, source: CertificateTemplate['source']): TemplateSet {
  const out = emptySet()
  for (const row of (rows ?? []) as CertificateTemplate[]) {
    if (isAwardType(row.award_type)) out[row.award_type] = normalise(row, source)
  }
  return out
}

/** The event's own uploads, one per award (null where it has none). */
export async function loadEventTemplates(db: SupabaseClient, slug: string): Promise<TemplateSet> {
  const { data, error } = await db.from('event_certificate_templates').select(TEMPLATE_COLUMNS).eq('event_slug', slug)
  if (error) throw new Error(`[event-certificates] templates: ${error.message}`)
  return toSet(data, 'event')
}

export async function loadEventTemplate(db: SupabaseClient, slug: string, award: AwardType): Promise<CertificateTemplate | null> {
  const { data } = await db
    .from('event_certificate_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('event_slug', slug)
    .eq('award_type', award)
    .maybeSingle()
  return data ? normalise(data as CertificateTemplate, 'event') : null
}

/** A theme's defaults, one per award. */
export async function loadDefaultTemplates(db: SupabaseClient, theme: ArtworkTheme): Promise<TemplateSet> {
  const { data, error } = await db.from('default_certificate_templates').select(TEMPLATE_COLUMNS).eq('theme', theme)
  if (error) throw new Error(`[event-certificates] default templates: ${error.message}`)
  return toSet(data, 'default')
}

export async function loadDefaultTemplate(db: SupabaseClient, theme: ArtworkTheme, award: AwardType): Promise<CertificateTemplate | null> {
  const { data } = await db
    .from('default_certificate_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('theme', theme)
    .eq('award_type', award)
    .maybeSingle()
  return data ? normalise(data as CertificateTemplate, 'default') : null
}

/** What prints: each award's own upload, else its theme default. */
export function effectiveTemplates(own: TemplateSet, defaults: TemplateSet): TemplateSet {
  return Object.fromEntries(AWARD_TYPES.map((t) => [t, own[t] ?? defaults[t] ?? null])) as TemplateSet
}

export async function loadTemplates(db: SupabaseClient, slug: string, theme: ArtworkTheme): Promise<TemplateSet> {
  const [own, defaults] = await Promise.all([loadEventTemplates(db, slug), loadDefaultTemplates(db, theme)])
  return effectiveTemplates(own, defaults)
}

export async function loadTemplate(
  db: SupabaseClient,
  slug: string,
  award: AwardType,
  theme: ArtworkTheme,
): Promise<CertificateTemplate | null> {
  return (await loadEventTemplate(db, slug, award)) ?? (await loadDefaultTemplate(db, theme, award))
}

/**
 * Before a default certificate's artwork changes or goes: every event that has
 * issued this award on that default gets its own copy, so its members' downloads
 * keep printing the artwork they were issued on. Events with their own upload
 * keep it. Returns how many events were pinned.
 */
export async function pinDefaultCertificate(
  db: SupabaseClient,
  theme: ArtworkTheme,
  outgoing: CertificateTemplate,
): Promise<number> {
  const slugs = await eventsIssuedOn(db, { source: 'event', theme, awardType: outgoing.award_type })
  if (slugs.length === 0) return 0
  const { data: own, error: ownError } = await db
    .from('event_certificate_templates')
    .select('event_slug')
    .eq('award_type', outgoing.award_type)
    .in('event_slug', slugs)
  if (ownError) throw new Error(`[event-certificates] pin: ${ownError.message}`)
  const have = new Set(((own ?? []) as { event_slug: string }[]).map((r) => r.event_slug))
  const rows = slugs
    .filter((s) => !have.has(s))
    .map((event_slug) => ({
      event_slug,
      award_type: outgoing.award_type,
      artwork_path: outgoing.artwork_path,
      name_y: outgoing.name_y,
      name_max_width: outgoing.name_max_width,
      name_size: outgoing.name_size,
    }))
  if (rows.length === 0) return 0
  const { error } = await db
    .from('event_certificate_templates')
    .upsert(rows, { onConflict: 'event_slug,award_type', ignoreDuplicates: true })
  if (error) throw new Error(`[event-certificates] pin: ${error.message}`)
  return rows.length
}

// numeric columns arrive as strings from PostgREST.
function normalise(row: CertificateTemplate, source: CertificateTemplate['source']): CertificateTemplate {
  return {
    ...row,
    name_y: Number(row.name_y),
    name_max_width: Number(row.name_max_width),
    name_size: Number(row.name_size),
    source,
  }
}

export function placementOf(t: Pick<CertificateTemplate, 'name_y' | 'name_max_width' | 'name_size'> | null): NamePlacement {
  if (!t) return DEFAULT_NAME_PLACEMENT
  return { nameY: t.name_y, nameMaxWidth: t.name_max_width, nameSize: t.name_size }
}

/** Placement overrides from a query string (the admin's unsaved sliders). */
export function placementFromParams(base: NamePlacement, params: URLSearchParams): NamePlacement {
  const num = (k: string, min: number, max: number, fallback: number) => {
    const v = Number(params.get(k))
    return params.has(k) && Number.isFinite(v) && v >= min && v <= max ? v : fallback
  }
  return {
    nameY:        num('name_y', 0.01, 0.99, base.nameY),
    nameMaxWidth: num('name_max_width', 0.05, 1, base.nameMaxWidth),
    nameSize:     num('name_size', 8, 120, base.nameSize),
  }
}

export async function downloadArtwork(db: SupabaseClient, storagePath: string): Promise<Artwork | null> {
  const { data: blob } = await db.storage.from(RESOURCES_BUCKET).download(storagePath)
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  // Sniff rather than trust the extension: the claim step already checked the
  // magic bytes, so this is the same answer, from the same source.
  const mime = bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : 'image/jpeg'
  return { bytes, mime }
}

// ── Students ─────────────────────────────────────────────────────────────────

export interface EventStudent {
  id: string
  member_id: string | null
  first_name: string
  last_name: string
  email: string
  date_of_birth: string
  event_role: string
  company_id: string | null
  checked_in_at: string | null
  emergency_contact_first_name: string | null
  emergency_contact_email: string | null
}

const STUDENT_COLUMNS =
  'id, member_id, first_name, last_name, email, date_of_birth, event_role, company_id, checked_in_at, emergency_contact_first_name, emergency_contact_email'

/** Every student (incl. Student Managers) on a live registration, by surname. */
export async function listEventStudents(db: SupabaseClient, slug: string): Promise<EventStudent[]> {
  const { data, error } = await db
    .from('registrations')
    .select(`id, participants(${STUDENT_COLUMNS})`)
    .eq('event_slug', slug)
    .neq('status', 'withdrawn')
  if (error) throw new Error(`[event-certificates] students: ${error.message}`)
  return ((data ?? []) as { participants: EventStudent[] | null }[])
    .flatMap((r) => r.participants ?? [])
    .filter((p) => STUDENT_ROLES.includes(p.event_role))
    .sort(bySurname)
}

// ── Mentors ──────────────────────────────────────────────────────────────────

export interface EventMentor {
  member_id: string
  first_name: string
  last_name: string
  email: string | null
  date_of_birth: string | null
}

/**
 * Every volunteer mentor assigned to the event on its Volunteers panel (an
 * active cohort_members 'volunteer' row on the event-level container), by
 * surname. Mentors have no participants row; they are members.
 */
export async function listEventMentors(db: SupabaseClient, slug: string): Promise<EventMentor[]> {
  const { data: container } = await db
    .from('mentoring_cohorts')
    .select('id')
    .eq('container_type', 'event_participation')
    .is('parent_container_id', null)
    .eq('campaign_ref', slug)
    .maybeSingle()
  if (!container?.id) return []
  const { data, error } = await db
    .from('cohort_members')
    .select('member_id, members(first_name, last_name, email, date_of_birth, is_active)')
    .eq('cohort_id', container.id)
    .eq('relationship', 'volunteer')
    .eq('status', 'active')
  if (error) throw new Error(`[event-certificates] mentors: ${error.message}`)
  type M = { first_name: string | null; last_name: string | null; email: string | null; date_of_birth: string | null; is_active: boolean | null }
  return ((data ?? []) as { member_id: string; members: M | M[] | null }[])
    .map((r) => ({ id: r.member_id, m: Array.isArray(r.members) ? r.members[0] : r.members }))
    .filter((r): r is { id: string; m: M } => !!r.m && r.m.is_active !== false)
    .map(({ id, m }) => ({
      member_id: id,
      first_name: m.first_name ?? '',
      last_name: m.last_name ?? '',
      email: m.email,
      date_of_birth: m.date_of_birth,
    }))
    .sort(bySurname)
}

export function fullName(p: { first_name: string; last_name: string }): string {
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.replace(/\s+/g, ' ').trim()
}

function bySurname(a: { first_name: string; last_name: string }, b: { first_name: string; last_name: string }) {
  return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
}

export interface EventCompany {
  id: string
  number: number
  name: string | null
}

export async function listEventCompanies(db: SupabaseClient, slug: string): Promise<EventCompany[]> {
  const { data, error } = await db.from('event_companies').select('id, number, name').eq('event_slug', slug).order('number')
  if (error) throw new Error(`[event-certificates] companies: ${error.message}`)
  return (data ?? []) as EventCompany[]
}

export function companyLabel(c: EventCompany | undefined | null): string {
  if (!c) return 'No company'
  return c.name ? `Company ${c.number} · ${c.name}` : `Company ${c.number}`
}

// ── Assignments ──────────────────────────────────────────────────────────────

export interface AssignmentRow {
  id: string
  award_type: AssignedAwardType
  participant_id: string
  company_id: string | null
  assigned_at: string
}

export async function listAssignments(db: SupabaseClient, slug: string): Promise<AssignmentRow[]> {
  const { data, error } = await db
    .from('event_award_assignments')
    .select('id, award_type, participant_id, company_id, assigned_at')
    .eq('event_slug', slug)
  if (error) throw new Error(`[event-certificates] assignments: ${error.message}`)
  return ((data ?? []) as AssignmentRow[]).filter((a) => isAssignedAwardType(a.award_type))
}

/**
 * Who gets a certificate for `award`: every student for participation, the
 * assignees otherwise. Ordered by company then surname, so a printed stack
 * sorts into company piles.
 */
export function recipientsFor(
  award: AwardType,
  students: EventStudent[],
  assignments: AssignmentRow[],
  companies: EventCompany[],
): EventStudent[] {
  const chosen =
    award === 'participation'
      ? students
      : students.filter((s) => assignments.some((a) => a.award_type === award && a.participant_id === s.id))
  const order = new Map(companies.map((c) => [c.id, c.number]))
  const rank = (s: EventStudent) => (s.company_id ? order.get(s.company_id) ?? 99 : 100)
  return [...chosen].sort((a, b) => rank(a) - rank(b) || bySurname(a, b))
}
