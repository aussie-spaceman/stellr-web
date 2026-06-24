import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'

export const dynamic = 'force-dynamic'

export default async function SpaceAnnouncementsPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>
}) {
  const { spaceSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space) notFound()
  if (!space.access.canAccess) return <LockedSpaceGate space={space} />

  const db = supabaseServer()
  const { data } = await db
    .from('community_announcements')
    .select('id, title, body, created_at, members:author_member_id(first_name, last_name)')
    .eq('space_id', space.id)
    .order('created_at', { ascending: false })

  type Rel = { first_name: string | null; last_name: string | null }
  type Row = { id: string; title: string; body: string | null; created_at: string; members: Rel | Rel[] | null }
  const items = ((data ?? []) as unknown as Row[]).map((a) => {
    const m = Array.isArray(a.members) ? a.members[0] ?? null : a.members
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      createdAt: a.created_at,
      author: m ? [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Admin' : 'Admin',
    }
  })

  return (
    <SpaceShell space={space} activeKey="announcements">
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-4 font-heading text-[21px] text-brand-blue-dark">Announcements</h1>
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-brand-muted-soft">No announcements yet.</p>
        ) : (
          <div className="space-y-3">
            {items.map((a) => (
              <article
                key={a.id}
                className="rounded-[14px] border border-brand-border bg-white p-4 shadow-card"
                style={{ borderLeft: '3px solid #E0922F' }}
              >
                <h2 className="font-heading text-[16px] text-brand-blue-dark">{a.title}</h2>
                <p className="mt-0.5 text-xs text-brand-muted-soft">
                  {a.author} ·{' '}
                  {new Date(a.createdAt).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
                {a.body && <p className="mt-2 whitespace-pre-wrap text-sm text-brand-muted">{a.body}</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </SpaceShell>
  )
}
