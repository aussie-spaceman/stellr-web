import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { AnnouncementForm } from '@/components/admin/community/AnnouncementForm'
import { Megaphone } from 'lucide-react'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const { data } = await db.from('community_spaces').select('name').eq('id', id).maybeSingle()
  return { title: `Admin — ${data?.name ?? 'Space'}` }
}

// Per-space admin detail page: announcements panel + recent posts.
export default async function AdminSpaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()

  const [{ data: space }, { data: announcements }] = await Promise.all([
    db.from('community_spaces').select('id, name, slug, description, min_tier_rank').eq('id', id).maybeSingle(),
    db
      .from('community_posts')
      .select('id, title, status, created_at')
      .eq('space_id', id)
      .eq('is_announcement', true)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  if (!space) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/community/spaces" className="text-sm text-brand-blue hover:text-brand-blue">
          ← All spaces
        </Link>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark mt-1">{space.name}</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          /{space.slug}
          {space.description ? ` · ${space.description}` : ''}
          {' · '}
          {space.min_tier_rank === 0 ? 'All members' : 'Paid tiers'}
        </p>
      </div>

      <AnnouncementForm
        spaces={[{ id: space.id as string, name: space.name as string, slug: space.slug as string }]}
        lockedSpaceId={space.id as string}
      />

      <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
        <div className="border-b border-brand-hairline bg-brand-canvas px-4 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">
            Announcements in this space
          </p>
        </div>
        <ul className="divide-y divide-brand-hairline">
          {(announcements ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-3">
              <Megaphone className="h-4 w-4 shrink-0 text-brand-blue" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-brand-blue-dark">{a.title}</p>
                <p className="text-xs text-brand-muted-soft">
                  {formatDateShort(a.created_at)}
                  {a.status !== 'published' && (
                    <span className="ml-2 rounded bg-brand-hairline px-1.5 py-0.5 text-xs capitalize text-brand-muted-soft">
                      {a.status}
                    </span>
                  )}
                </p>
              </div>
            </li>
          ))}
          {(!announcements || announcements.length === 0) && (
            <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">
              No announcements yet for this space.
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
