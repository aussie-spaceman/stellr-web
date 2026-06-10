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
        <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Admin-posted announcements visible to all members (FR-COM-05)
        </p>
      </div>

      <AnnouncementForm spaces={spaces ?? []} />

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Past announcements</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {(announcements ?? []).map((a) => {
            const space = Array.isArray(a.community_spaces) ? a.community_spaces[0] : a.community_spaces as { name: string; slug: string } | null
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Megaphone className="h-4 w-4 shrink-0 text-blue-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{a.title}</p>
                  <p className="text-xs text-gray-400">
                    {space?.name ?? '—'} · {new Date(a.created_at).toLocaleDateString()}
                    {a.status !== 'published' && (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs capitalize text-gray-500">
                        {a.status}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            )
          })}
          {(!announcements || announcements.length === 0) && (
            <li className="px-4 py-6 text-center text-sm text-gray-400">No announcements yet.</li>
          )}
        </ul>
      </div>
    </div>
  )
}
