import { notFound, redirect } from 'next/navigation'
import { getCurrentMember, resourceTierAllowed } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'
import { ResourcesList, type ResourceItem } from '@/components/community/spaces/ResourcesList'

export const dynamic = 'force-dynamic'

export default async function SpaceResourcesPage({
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
    .from('community_resources')
    .select('id, title, file_type, from_chat, file_size_bytes, created_at, members:uploaded_by(first_name, last_name)')
    .eq('space_id', space.id)
    .order('created_at', { ascending: false })

  type Rel = { first_name: string | null; last_name: string | null }
  type Row = {
    id: string
    title: string
    file_type: string | null
    from_chat: boolean
    file_size_bytes: number | null
    created_at: string
    members: Rel | Rel[] | null
  }
  // Honour per-resource tier overrides: hide resources this member isn't allowed
  // to download (admins see everything).
  const rows = (data ?? []) as unknown as Row[]
  const allowedIds = new Set<string>()
  await Promise.all(rows.map(async (r) => {
    if (await resourceTierAllowed(member, r.id)) allowedIds.add(r.id)
  }))

  const items: ResourceItem[] = rows.filter((r) => allowedIds.has(r.id)).map((r) => {
    const u = Array.isArray(r.members) ? r.members[0] ?? null : r.members
    return {
      id: r.id,
      title: r.title,
      fileType: r.file_type,
      fromChat: !!r.from_chat,
      sizeBytes: r.file_size_bytes,
      createdAt: r.created_at,
      uploaderName: u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || null : null,
    }
  })

  return (
    <SpaceShell space={space} activeKey="resources">
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-4 font-heading text-[21px] text-brand-blue-dark">Resources</h1>
        <ResourcesList items={items} />
      </div>
    </SpaceShell>
  )
}
