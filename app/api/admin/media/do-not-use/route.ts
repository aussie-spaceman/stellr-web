import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentTenantId, requireTenantCrew } from '@/lib/authz'
import { toCsv } from '@/lib/csv'
import { mediaDoNotUseList, mediaListRows } from '@/lib/survey/media'
import { enforcedTenantFilter } from '@/lib/tenancy/load-scoped'
import { isStellrScope, tenantWideScope } from '@/lib/tenancy/scope-context'

const ROUTE = '/api/admin/media/do-not-use'

// GET /api/admin/media/do-not-use?event=<slug>&show=all
// The media do-not-use list as CSV (privacy runbook Part C): everyone whose
// photo, video, name or work must not be used, and everyone to check by hand
// (show=all: everyone, with the reason). Admins only.
export const maxDuration = 60

export async function GET(req: Request) {
  const admin = await requireTenantCrew(currentTenantId(), ['tenant_admin'], { route: ROUTE })
  if (!admin.ok) return NextResponse.json({ error: admin.status === 401 ? 'Unauthorised' : 'Admins only' }, { status: admin.status })
  const params = new URL(req.url).searchParams
  const eventSlug = params.get('event') || null
  const includeOk = params.get('show') === 'all'
  const scope = tenantWideScope(admin.tenantId, 'tenant_admin')
  const { rows } = await mediaDoNotUseList(supabaseServer(), {
    eventSlug,
    includeOk,
    tenant: enforcedTenantFilter(scope, 'registrations'),
    skipMemberOnly: !isStellrScope(scope),
  })
  const name = `media-do-not-use${eventSlug ? `-${eventSlug}` : ''}-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(toCsv(mediaListRows(rows)), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
