import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { supabaseServer } from '@/lib/supabase'
import { resolveMemberSpaces } from '@/lib/spaces'
import { resolveTierMap } from '@/lib/tiers-server'
import { ROLE_LABELS, type MemberRole } from '@/lib/member-roles'

// Which Spaces this member can reach, and why — the member-record counterpart of
// the Space Members tab. READ ONLY: access is changed from the Space itself, so
// there is exactly one write surface for it.
//
// Reads lib/spaces resolveMemberSpaces, the same resolver the Space roster uses,
// so "who is in this space" and "which spaces is this person in" cannot disagree.

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: memberId } = await params
  try {
    const grants = await resolveMemberSpaces(memberId)

    // Name the specific grant, so "revoke" has something to argue with.
    const db = supabaseServer()
    const tierMap = grants.some((g) => g.reason === 'tier') ? await resolveTierMap() : null

    const objectRefs = grants
      .filter((g) => g.reason === 'object' && g.grantRef)
      .map((g) => g.grantRef as string)
    const objectLabels = new Map<string, string>()
    if (objectRefs.length) {
      // Only the DB-backed refs resolve here; an event ref stays its slug, which
      // is still the thing an admin recognises in the Space's own source list.
      const ids = objectRefs
        .filter((r) => !r.startsWith('event:'))
        .map((r) => r.split(':')[1])
      if (ids.length) {
        const [{ data: mods }, { data: cohorts }] = await Promise.all([
          db.from('training_modules').select('id, title').in('id', ids),
          db.from('mentoring_cohorts').select('id, name').in('id', ids),
        ])
        for (const m of (mods ?? []) as Array<{ id: string; title: string }>) {
          objectLabels.set(`training:${m.id}`, m.title)
        }
        for (const c of (cohorts ?? []) as Array<{ id: string; name: string | null }>) {
          objectLabels.set(`mentoring:${c.id}`, c.name ?? c.id)
          objectLabels.set(`coaching:${c.id}`, c.name ?? c.id)
        }
      }
    }

    return NextResponse.json({
      spaces: grants.map((g) => ({
        ...g,
        grantLabel:
          !g.grantRef ? null
          : g.reason === 'tier' ? tierMap?.nameById[g.grantRef] ?? null
          : g.reason === 'role' ? ROLE_LABELS[g.grantRef as MemberRole] ?? g.grantRef
          : objectLabels.get(g.grantRef) ?? g.grantRef.split(':').slice(1).join(':'),
      })),
    })
  } catch (e) {
    // An empty list here reads as "this person is in no spaces" — the wrong
    // conclusion to hand an admin investigating access. Fail visibly instead.
    console.error('[admin/members/spaces] load failed:', e)
    return NextResponse.json({ error: 'Could not resolve space access' }, { status: 500 })
  }
}
