import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { filterFrom, requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { exportFilename, loadLongRows, longCsv, wideCsv } from '@/lib/survey/export'
import { logSurveyAccess } from '@/lib/survey/audit'

// GET /api/admin/surveys/export?format=long|wide&event=&year=&survey=
// Survey answers as CSV (handover A3). Admin only; logged to survey_access_log.
export async function GET(req: Request) {
  const gate = await requireSurveyAdmin()
  if (!gate.ok) return gate.response
  const f = filterFrom(req.url)
  const format = new URL(req.url).searchParams.get('format') === 'wide' ? 'wide' : 'long'
  const db = supabaseServer()
  const rows = await loadLongRows(db, f)
  await logSurveyAccess(db, { actor: gate.userId, action: 'export', eventSlug: f.eventSlug, rowCount: rows.length, detail: { format, ...f } })
  const csv = format === 'wide' ? wideCsv(rows) : longCsv(rows)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(format, f)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
