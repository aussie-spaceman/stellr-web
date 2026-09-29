// Mentor background-check reports, exported as one PDF (per event or per mentor).
//
// Two modes, by who is asking:
//   checkr  — admins. A cover page listing every mentor, then each cleared
//             mentor's own Checkr PDF report, fetched from Checkr at export time.
//   summary — event managers. The cover page alone: name, clearance, dates. A
//             Checkr report is a consumer report under the FCRA (address history,
//             DOB, any records found); it goes to Stellr admins only.
//
// Nothing is stored. Checkr's download links expire after an hour, and keeping
// copies would put consumer reports in our storage and our retention scope.
//
// "Cleared" is deriveCompliance's valid_bc as of the event date: a passed check,
// or a flagged one an admin adjudicated as cleared, not past its 3-year expiry.
// Mentors cleared by a verified teacher license have no Checkr report; they are
// listed as such rather than silently dropped.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deriveCompliance,
  loadComplianceRecordsForMembers,
  type ComplianceState,
  type MemberComplianceRecords,
} from '@/lib/compliance'
import { ReportPdfUnavailableError, type BackgroundProvider } from '@/lib/background-provider'
import { logActivity, type Actor } from '@/lib/activity-log'
import { formatDateShort } from '@/lib/utils'

export type ExportMode = 'checkr' | 'summary'

/**
 * Which export a request gets. Only an admin can have Checkr's reports; an
 * admin can also ask for the summary (?mode=summary) to hand to an event team.
 * Event managers get the summary whatever they ask for.
 */
export function exportModeFor(isAdmin: boolean, requested: string | null): ExportMode {
  return isAdmin && requested !== 'summary' ? 'checkr' : 'summary'
}

export interface EventMentor {
  /** Set for registered mentors (the roster row); null for assigned volunteers. */
  participantId: string | null
  memberId: string | null
  firstName: string
  lastName: string
  email: string | null
}

export type RowOutcome =
  | 'included' // cleared by background check, report ref on file
  | 'unavailable' // cleared, but no Checkr PDF to attach
  | 'failed' // cleared, but fetching the PDF failed this time
  | 'license' // cleared by verified teacher license — no Checkr report exists
  | 'not_cleared'
  | 'not_required' // under 18 at the event
  | 'no_account' // registered with an email that has no Stellr member row

export interface MentorRow {
  mentor: EventMentor
  memberId: string | null
  state: ComplianceState | null
  reportRef: string | null
  validUntil: string | null
  outcome: RowOutcome
  /** Why, in a phrase — shown under the name on the cover page. */
  note: string | null
}

// ── Who the mentors are ───────────────────────────────────────────────────────

type Named = { first_name: string | null; last_name: string | null; email: string | null }

/**
 * Everyone mentoring at the event: participants registered with the mentor
 * role, and active volunteers assigned to the event's container (the same two
 * sources as loadBadgeHolders). Sorted by surname.
 */
export async function loadEventMentors(db: SupabaseClient, slug: string): Promise<EventMentor[]> {
  const [{ data: regs }, { data: container }] = await Promise.all([
    db
      .from('registrations')
      .select('id, participants(id, member_id, first_name, last_name, email, event_role)')
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

  const mentors: EventMentor[] = (regs ?? [])
    .flatMap((r) => (r.participants as Record<string, unknown>[]) ?? [])
    .filter((p) => p.event_role === 'mentor')
    .map((p) => ({
      participantId: p.id as string,
      memberId: (p.member_id as string | null) ?? null,
      firstName: (p.first_name as string) ?? '',
      lastName: (p.last_name as string) ?? '',
      email: (p.email as string | null) ?? null,
    }))

  if (container?.id) {
    const { data: volunteers } = await db
      .from('cohort_members')
      .select('member_id, members(first_name, last_name, email)')
      .eq('cohort_id', container.id)
      .eq('relationship', 'volunteer')
      .eq('status', 'active')
    const seen = new Set(mentors.map((m) => m.memberId).filter(Boolean))
    for (const v of volunteers ?? []) {
      if (seen.has(v.member_id)) continue
      const m = (Array.isArray(v.members) ? v.members[0] : v.members) as Named | null
      if (!m) continue
      seen.add(v.member_id)
      mentors.push({
        participantId: null,
        memberId: v.member_id,
        firstName: m.first_name ?? '',
        lastName: m.last_name ?? '',
        email: m.email,
      })
    }
  }

  return mentors.sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`))
}

// ── Who is cleared ────────────────────────────────────────────────────────────

/** Classify one mentor from their records, as of the event date. Pure. */
export function classifyMentor(
  mentor: EventMentor,
  records: MemberComplianceRecords | undefined,
  eventDate?: string,
): MentorRow {
  const base = { mentor, memberId: records?.memberId ?? mentor.memberId, reportRef: null, validUntil: null }
  if (!records) {
    return { ...base, state: null, outcome: 'no_account', note: 'No Stellr account for this email' }
  }
  const c = deriveCompliance(records.license, records.checks, 'mentor', records.dateOfBirth, eventDate)
  if (c.state === 'valid_bc') {
    const reportRef = c.check?.provider_report_ref ?? null
    return {
      ...base,
      state: c.state,
      reportRef,
      validUntil: c.check?.expires_at ?? null,
      outcome: reportRef ? 'included' : 'unavailable',
      note: reportRef ? c.detail : 'Cleared, but no Checkr report is on file',
    }
  }
  if (c.state === 'valid_license') {
    return { ...base, state: c.state, validUntil: c.license?.expiry_date ?? null, outcome: 'license', note: c.detail }
  }
  if (c.state === 'not_required') {
    return { ...base, state: c.state, outcome: 'not_required', note: 'Under 18 at the event' }
  }
  return { ...base, state: c.state, outcome: 'not_cleared', note: c.detail }
}

/** Load records for every mentor and classify them. */
export async function classifyMentors(
  db: SupabaseClient,
  mentors: EventMentor[],
  eventDate?: string,
): Promise<MentorRow[]> {
  const { byId, byEmail } = await loadComplianceRecordsForMembers(
    db,
    mentors.map((m) => m.memberId).filter((x): x is string => !!x),
    mentors.map((m) => m.email).filter((x): x is string => !!x),
  )
  return mentors.map((m) =>
    classifyMentor(
      m,
      (m.memberId ? byId.get(m.memberId) : undefined) ?? (m.email ? byEmail.get(m.email.trim().toLowerCase()) : undefined),
      eventDate,
    ),
  )
}

// ── The PDF ───────────────────────────────────────────────────────────────────

const PAGE: [number, number] = [612, 792] // US Letter
const MARGIN = 48
const ROWS_PER_PAGE = 14
const ROW_H = 32
const COLS = { name: MARGIN, status: 236, valid: 392, report: 470 }

const STATUS_LABEL: Record<RowOutcome, string> = {
  included: 'Cleared: background check',
  unavailable: 'Cleared: background check',
  failed: 'Cleared: background check',
  license: 'Cleared: teacher license',
  not_cleared: 'Not cleared',
  not_required: 'Not required',
  no_account: 'Not cleared',
}

// Helvetica (WinAnsi) cannot encode every character a name may hold; pdf-lib
// throws on one it can't. Fold accents, then replace anything left over.
export function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = pdfSafe(text)
  if (font.widthOfTextAtSize(t, size) <= width) return t
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1)
  return `${t}...`
}

const INK = rgb(0.1, 0.12, 0.2)
const MUTED = rgb(0.42, 0.45, 0.52)
const RULE = rgb(0.86, 0.87, 0.9)

interface CoverInput {
  rows: MentorRow[]
  mode: ExportMode
  title: string
  generatedBy: string | null
  now: Date
  /** checkr mode: the page each attached report starts on, by row index. */
  startPages: Map<number, number>
}

export function coverPageCount(rowCount: number): number {
  return Math.max(1, Math.ceil(rowCount / ROWS_PER_PAGE))
}

async function drawCover(doc: PDFDocument, input: CoverInput): Promise<void> {
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pages = coverPageCount(input.rows.length)
  const cleared = input.rows.filter((r) => ['included', 'unavailable', 'failed', 'license'].includes(r.outcome)).length
  const attached = input.startPages.size

  for (let p = 0; p < pages; p++) {
    const page: PDFPage = doc.addPage(PAGE)
    const [, h] = PAGE
    let y = h - MARGIN

    page.drawText(fit(input.title, bold, 16, PAGE[0] - MARGIN * 2), { x: MARGIN, y: y - 16, size: 16, font: bold, color: INK })
    y -= 34
    const summary =
      input.mode === 'checkr'
        ? `${input.rows.length} mentor${input.rows.length === 1 ? '' : 's'}, ${cleared} cleared, ${attached} Checkr report${attached === 1 ? '' : 's'} attached`
        : `${input.rows.length} mentor${input.rows.length === 1 ? '' : 's'}, ${cleared} cleared`
    page.drawText(pdfSafe(summary), { x: MARGIN, y, size: 10, font: regular, color: MUTED })
    y -= 26

    page.drawText('Mentor', { x: COLS.name, y, size: 9, font: bold, color: MUTED })
    page.drawText('Clearance', { x: COLS.status, y, size: 9, font: bold, color: MUTED })
    page.drawText('Valid until', { x: COLS.valid, y, size: 9, font: bold, color: MUTED })
    page.drawText(input.mode === 'checkr' ? 'Checkr report' : 'Report ID', { x: COLS.report, y, size: 9, font: bold, color: MUTED })
    y -= 8
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE[0] - MARGIN, y }, thickness: 0.5, color: RULE })
    y -= 14

    const slice = input.rows.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE)
    slice.forEach((row, i) => {
      const index = p * ROWS_PER_PAGE + i
      const name = `${row.mentor.firstName} ${row.mentor.lastName}`.trim() || row.mentor.email || 'Unnamed mentor'
      page.drawText(fit(name, bold, 10, COLS.status - COLS.name - 8), { x: COLS.name, y, size: 10, font: bold, color: INK })
      page.drawText(fit(STATUS_LABEL[row.outcome], regular, 10, COLS.valid - COLS.status - 8), { x: COLS.status, y, size: 10, font: regular, color: INK })
      if (row.validUntil) {
        page.drawText(pdfSafe(formatDateShort(row.validUntil)), { x: COLS.valid, y, size: 10, font: regular, color: INK })
      }
      const start = input.startPages.get(index)
      const reportCell =
        input.mode === 'checkr'
          ? start
            ? `Page ${start}`
            : row.outcome === 'failed'
              ? 'Could not fetch'
              : row.outcome === 'unavailable'
                ? 'None available'
                : ''
          : (row.reportRef ?? '')
      if (reportCell) {
        page.drawText(fit(reportCell, regular, 10, PAGE[0] - MARGIN - COLS.report), { x: COLS.report, y, size: 10, font: regular, color: INK })
      }
      if (row.note) {
        page.drawText(fit(row.note, regular, 8, PAGE[0] - MARGIN * 2), { x: COLS.name, y: y - 12, size: 8, font: regular, color: MUTED })
      }
      y -= ROW_H
    })

    const footer = [
      `Generated ${formatDateShort(input.now.toISOString())}${input.generatedBy ? ` by ${input.generatedBy}` : ''}. Page ${p + 1} of ${pages}.`,
      input.mode === 'checkr'
        ? 'Confidential. Contains consumer reports under the FCRA. Do not forward or share outside Stellr.'
        : 'Confidential. Clearance summary only; full Checkr reports are held by Stellr admins.',
    ]
    footer.forEach((line, i) => {
      page.drawText(fit(line, regular, 8, PAGE[0] - MARGIN * 2), { x: MARGIN, y: MARGIN - i * 11, size: 8, font: regular, color: MUTED })
    })
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

export interface BuildResult {
  pdf: Uint8Array
  /** Rows with outcomes updated by the fetch (included → failed/unavailable). */
  rows: MentorRow[]
}

/**
 * Build the export. In checkr mode each included row's report is fetched (four
 * at a time); a row whose fetch fails is marked on the cover rather than
 * failing the export. A single included row with no cover requested returns
 * Checkr's PDF as-is.
 */
export async function buildMentorReportPdf(opts: {
  rows: MentorRow[]
  mode: ExportMode
  provider?: BackgroundProvider
  title: string
  generatedBy: string | null
  /** Return a lone report without a cover page (per-mentor download). */
  bareSingle?: boolean
  now?: Date
}): Promise<BuildResult> {
  const rows = opts.rows.map((r) => ({ ...r }))
  const sources = new Map<number, PDFDocument>()

  if (opts.mode === 'checkr') {
    if (!opts.provider) throw new Error('checkr mode needs a provider')
    const provider = opts.provider
    const fetched = await mapLimit(rows, 4, async (row) => {
      if (row.outcome !== 'included' || !row.reportRef) return null
      try {
        return await provider.fetchReportPdf(row.reportRef)
      } catch (err) {
        if (err instanceof ReportPdfUnavailableError) {
          row.outcome = 'unavailable'
          row.note = 'Cleared, but Checkr has no PDF for this report'
        } else {
          console.error('[background-report-export] fetch failed:', row.reportRef, err)
          row.outcome = 'failed'
          row.note = 'Cleared, but the Checkr report could not be fetched. Try again, or open it in Checkr.'
        }
        return null
      }
    })

    if (opts.bareSingle && rows.length === 1 && fetched[0]) {
      return { pdf: fetched[0], rows }
    }

    for (const [i, bytes] of fetched.entries()) {
      if (!bytes) continue
      try {
        sources.set(i, await PDFDocument.load(bytes, { ignoreEncryption: true }))
      } catch (err) {
        console.error('[background-report-export] unreadable PDF:', rows[i].reportRef, err)
        rows[i].outcome = 'failed'
        rows[i].note = 'Cleared, but the Checkr report could not be read. Open it in Checkr.'
      }
    }
  }

  // Page numbers for the cover need the cover's own length first.
  const startPages = new Map<number, number>()
  let page = coverPageCount(rows.length) + 1
  for (const [i, src] of [...sources.entries()].sort(([a], [b]) => a - b)) {
    startPages.set(i, page)
    page += src.getPageCount()
  }

  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(opts.title))
  doc.setProducer('Stellr Education')
  await drawCover(doc, { rows, mode: opts.mode, title: opts.title, generatedBy: opts.generatedBy, now: opts.now ?? new Date(), startPages })
  for (const [, src] of [...sources.entries()].sort(([a], [b]) => a - b)) {
    const copied = await doc.copyPages(src, src.getPageIndices())
    copied.forEach((p) => doc.addPage(p))
  }
  return { pdf: await doc.save(), rows }
}

// ── Audit ─────────────────────────────────────────────────────────────────────

/**
 * One activity-log entry per mentor whose record left the building: every
 * attached Checkr report (checkr mode), or every listed member (summary mode).
 */
export async function logReportExport(
  db: SupabaseClient,
  rows: MentorRow[],
  ctx: { mode: ExportMode; eventSlug: string | null; scope: 'event' | 'mentor'; actor: Actor },
): Promise<void> {
  const logged = rows.filter((r) => r.memberId && (ctx.mode === 'summary' || r.outcome === 'included'))
  await Promise.all(
    logged.map((r) =>
      logActivity(
        {
          memberId: r.memberId!,
          category: 'compliance',
          action: ctx.mode === 'checkr' ? 'background_report_downloaded' : 'background_summary_downloaded',
          summary:
            ctx.mode === 'checkr'
              ? `Checkr background report downloaded${ctx.eventSlug ? ` (${ctx.eventSlug})` : ''}`
              : `Background clearance summary downloaded${ctx.eventSlug ? ` (${ctx.eventSlug})` : ''}`,
          metadata: { eventSlug: ctx.eventSlug, scope: ctx.scope, reportRef: r.reportRef },
          ...ctx.actor,
        },
        db,
      ),
    ),
  )
}

/** A filename-safe fragment. */
export function fileSlug(text: string): string {
  return (
    pdfSafe(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mentor'
  )
}
