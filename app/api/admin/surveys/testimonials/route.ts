import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { toCsv } from '@/lib/csv'
import { filterFrom, requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { exportFilename } from '@/lib/survey/export'
import { testimonials } from '@/lib/survey/quotes'
import { logSurveyAccess, writeAudit } from '@/lib/survey/audit'

// GET /api/admin/surveys/testimonials?event=&year=
// Quotable answers whose people allow quoting today, with the §2 attribution
// (V2.3 §1.7/§2: eligibility is decided now, never stored). Never a full name,
// contact detail or date of birth. Admin only; every export is logged to
// survey_access_log and audit_log.
export async function GET(req: Request) {
  const gate = await requireSurveyAdmin()
  if (!gate.ok) return gate.response
  const f = filterFrom(req.url)
  const db = supabaseServer()
  const { rows, excluded } = await testimonials(db, f)
  await logSurveyAccess(db, { actor: gate.userId, action: 'testimonial_export', eventSlug: f.eventSlug, rowCount: rows.length, detail: { ...f, excluded: excluded.length } })
  await writeAudit(db, {
    table: 'survey_testimonial_export',
    action: 'INSERT',
    actor: gate.userId,
    data: { filter: f, quotes: rows.length, response_ids: [...new Set(rows.map((r) => r.responseId))] },
  })
  const csv = toCsv([
    ['event_slug', 'event_year', 'role', 'question_key', 'quote', 'attribution', 'attribution_kind', 'response_id'],
    ...rows.map((r) => [r.eventSlug, r.eventYear, r.role, r.questionKey, r.quote, r.attribution, r.attributionKind, r.responseId]),
  ])
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename('testimonials', f)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
