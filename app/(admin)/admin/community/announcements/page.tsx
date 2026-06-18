import { supabaseServer } from '@/lib/supabase'
import { AnnouncementForm } from '@/components/admin/community/AnnouncementForm'
import { Megaphone } from 'lucide-react'

export const metadata = { title: 'Admin — Community Announcements' }

export default async function AdminAnnouncementsPage() {
  const db = supabaseServer()
  const [{ data: spaces }, { data: announcements }] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, name, slug')
      .eq('is_archived', false)
      .order('display_order'),
    db
      .from('community_posts')
      .select('id, title, status, created_at, community_spaces(name, slug)')
      .eq('is_announcement', true)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Announcements</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Admin-posted announcements visible to all members (FR-COM-05)
        </p>
      </div>

      <AnnouncementForm spaces={spaces ?? []} />

      <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
        <div className="border-b border-brand-hairline bg-brand-canvas px-4 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Past announcements</p>
        </div>
        <ul className="divide-y divide-brand-hairline">
          {(announcements ?? []).map((a) => {
            const space = Array.isArray(a.community_spaces) ? a.community_spaces[0] : a.community_spaces as { name: string; slug: string } | null
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Megaphone className="h-4 w-4 shrink-0 text-brand-blue" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-blue-dark">{a.title}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {space?.name ?? '—'} · {new Date(a.created_at).toLocaleDateString()}
                    {a.status !== 'published' && (
                      <span className="ml-2 rounded bg-brand-hairline px-1.5 py-0.5 text-xs capitalize text-brand-muted-soft">
                        {a.status}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            )
          })}
          {(!announcements || announcements.length === 0) && (
            <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">No announcements yet.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
