import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Search, FileText } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

export const metadata = { title: 'Community · Search' }

interface PostResult {
  id: string
  title: string
  body_text: string | null
  created_at: string
  community_spaces: { slug: string; name: string } | { slug: string; name: string }[] | null
}

interface ResourceResult {
  id: string
  title: string
  description: string | null
  file_type: string | null
}

function spaceOf(rel: PostResult['community_spaces']): { slug: string; name: string } | null {
  return Array.isArray(rel) ? rel[0] ?? null : rel
}

function snippet(text: string | null, q: string): string {
  if (!text) return ''
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  const start = Math.max(0, idx - 60)
  const raw = text.slice(start, start + 160)
  return (start > 0 ? '…' : '') + raw + (raw.length === 160 ? '…' : '')
}

// Search across community posts and resources (FR-COM-09).
export default async function CommunitySearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { q = '' } = await searchParams
  const trimmedQ = q.trim()

  let posts: PostResult[] = []
  let resources: ResourceResult[] = []

  if (trimmedQ.length >= 2) {
    const db = supabaseServer()
    const tsQuery = trimmedQ
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, '') + ':*')
      .filter((w) => w.length > 2)
      .join(' & ')

    const queries: Promise<void>[] = []

    if (tsQuery) {
      queries.push(
        db
          .from('community_posts')
          .select('id, title, body_text, created_at, community_spaces(slug, name)')
          .eq('status', 'published')
          .textSearch('body_text', tsQuery, { config: 'english', type: 'websearch' })
          .limit(8)
          .then(({ data }) => { if (data) posts = data as PostResult[] })
      )
    }

    // Title ilike catch (covers short queries where tsquery would fail)
    queries.push(
      db
        .from('community_posts')
        .select('id, title, body_text, created_at, community_spaces(slug, name)')
        .eq('status', 'published')
        .ilike('title', `%${trimmedQ}%`)
        .limit(8)
        .then(({ data }) => {
          if (data) {
            const existing = new Set(posts.map((p) => p.id))
            posts = [...posts, ...(data as PostResult[]).filter((p) => !existing.has(p.id))].slice(0, 10)
          }
        })
    )

    queries.push(
      db
        .from('community_resources')
        .select('id, title, description, file_type')
        .or(`title.ilike.%${trimmedQ}%,description.ilike.%${trimmedQ}%`)
        .limit(6)
        .then(({ data }) => { if (data) resources = data as ResourceResult[] })
    )

    await Promise.all(queries)
  }

  const total = posts.length + resources.length

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Search</h1>
      </div>

      <form method="GET" className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            name="q"
            defaultValue={trimmedQ}
            placeholder="Search posts and resources…"
            autoFocus
            className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-gray-400 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Search
        </button>
      </form>

      {trimmedQ && (
        <p className="mb-4 text-sm text-gray-500">
          {total} result{total !== 1 ? 's' : ''} for <strong>"{trimmedQ}"</strong>
        </p>
      )}

      {posts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Posts</h2>
          <ul className="space-y-2">
            {posts.map((post) => {
              const space = spaceOf(post.community_spaces)
              return (
                <li key={post.id}>
                  <Link
                    href={`/community/${space?.slug ?? 'general'}/${post.id}`}
                    className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
                  >
                    <p className="font-semibold text-gray-900">{post.title}</p>
                    {post.body_text && (
                      <p className="mt-1 text-sm text-gray-500 line-clamp-2">
                        {snippet(post.body_text, trimmedQ)}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-gray-400">
                      {space?.name ?? 'Community'} · {new Date(post.created_at).toLocaleDateString()}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {resources.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Resources</h2>
          <ul className="space-y-2">
            {resources.map((r) => (
              <li key={r.id}>
                <Link
                  href="/community/resources"
                  className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
                >
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                  <div>
                    <p className="font-semibold text-gray-900">{r.title}</p>
                    {r.description && (
                      <p className="mt-0.5 text-sm text-gray-500 line-clamp-2">{r.description}</p>
                    )}
                    {r.file_type && (
                      <p className="mt-1 text-xs text-gray-400">
                        {r.file_type.split('/')[1]?.toUpperCase()}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {trimmedQ.length >= 2 && total === 0 && (
        <div className="rounded-lg border border-dashed border-gray-200 py-12 text-center">
          <p className="text-sm text-gray-500">No results for "{trimmedQ}".</p>
          <p className="mt-1 text-xs text-gray-400">Try different keywords or browse a space.</p>
        </div>
      )}
    </div>
  )
}
