import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { Megaphone } from 'lucide-react'

export const metadata = { title: 'Admin — Announcements' }

// Read-only index of all announcements across all spaces.
// To create an announcement, go to the space's manage page (Community → Spaces → ⚙)
// or to an event's Announcements tab (/admin/events/[slug]?tab=announcements).
export default async function AdminAnnouncementsPage() {
  const db = supabaseServer()
  const { data: announcements } = await db
    .from('community_posts')
    .select('id, title, status, created_at, community_spaces(name, slug)')
    .eq('is_announcement', true)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Announcements</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          All announcements across all spaces. To post a new one, open the space from{' '}
          <Link href="/admin/community/spaces" className="text-brand-blue hover:underline">
            Spaces
          </Link>{' '}
          and use the announcement form there.
        </p>
      </div>

      <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
        <ul className="divide-y divide-brand-hairline">
          {(announcements ?? []).map((a) => {
            const space = Array.isArray(a.community_spaces)
              ? a.community_spaces[0]
              : (a.community_spaces as { name: string; slug: string } | null)
            return (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <Megaphone className="h-4 w-4 shrink-0 text-brand-blue" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-blue-dark">{a.title}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {space?.name ?? '—'} · {formatDateShort(a.created_at)}
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
