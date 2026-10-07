import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireSurveyAdmin } from '@/lib/survey/admin-auth'
import { toCsv } from '@/lib/csv'
import { mediaDoNotUseList, mediaListRows } from '@/lib/survey/media'

// GET /api/admin/media/do-not-use?event=<slug>&show=all
// The media do-not-use list as CSV (privacy runbook Part C): everyone whose
// photo, video, name or work must not be used, and everyone to check by hand
// (show=all: everyone, with the reason). Admins only.
export const maxDuration = 60

export async function GET(req: Request) {
  const gate = await requireSurveyAdmin()
  if (!gate.ok) return gate.response
  const params = new URL(req.url).searchParams
  const eventSlug = params.get('event') || null
  const includeOk = params.get('show') === 'all'
  const { rows } = await mediaDoNotUseList(supabaseServer(), { eventSlug, includeOk })
  const name = `media-do-not-use${eventSlug ? `-${eventSlug}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(toCsv(mediaListRows(rows)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
