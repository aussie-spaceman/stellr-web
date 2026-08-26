import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { loadSpaceMembersPage } from '@/lib/space-admin'

// The Space members roster, searched / filtered / paged.
//
// The Members tab renders its first page from the server component
// (loadSpaceAdmin) and calls this only once an admin searches, filters or pages.
// Both read lib/spaces resolveSpaceAudience, so the two views cannot disagree —
// the failure mode that had a Space showing "12 members" above a roster of none.
//
// An `open` Space's audience is every live member on the platform, so it is
// trimmed to exceptions (roster rows, role holders, blocked people) unless the
// caller searches or explicitly asks for everyone.

export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: spaceId } = await params
  const url = new URL(req.url)
  const num = (key: string) => {
    const raw = Number(url.searchParams.get(key))
    return Number.isFinite(raw) && raw > 0 ? raw : undefined
  }

  const status = url.searchParams.get('status')
  try {
    const page = await loadSpaceMembersPage(spaceId, {
      q: url.searchParams.get('q') ?? undefined,
      reason: url.searchParams.get('reason') ?? undefined,
      status: status === 'blocked' || status === 'invited' || status === 'active' ? status : undefined,
      page: num('page'),
      pageSize: num('pageSize'),
      includeEveryone: url.searchParams.get('all') === '1',
    })
    return NextResponse.json(page)
  } catch (e) {
    // This is an access-audit surface: an empty list would read as "nobody is in
    // this space", which is exactly the wrong conclusion to hand an admin.
    console.error('[admin/spaces/members] load failed:', e)
    return NextResponse.json({ error: 'Could not load the member list' }, { status: 500 })
  }
}
