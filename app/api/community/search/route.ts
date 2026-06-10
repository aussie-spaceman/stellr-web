import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// GET /api/community/search?q=... — full-text search across posts and resources (FR-COM-09).
// Uses the GIN tsvector indexes created in migration 012.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  if (!q || q.length < 2) return NextResponse.json({ posts: [], resources: [] })

  const db = supabaseServer()

  // Sanitise for tsquery: split on whitespace, prefix each term with :*, join with &
  const tsQuery = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, '') + ':*')
    .join(' & ')

  const [{ data: posts }, { data: resources }] = await Promise.all([
    db
      .from('community_posts')
      .select('id, title, body_text, created_at, community_spaces(slug, name)')
      .eq('status', 'published')
      .textSearch('body_text', tsQuery, { config: 'english', type: 'websearch' })
      .limit(10),
    db
      .from('community_resources')
      .select('id, title, description, file_type')
      .textSearch('title', tsQuery, { config: 'english', type: 'websearch' })
      .limit(10),
  ])

  // Also catch title-only matches for posts (body_text search misses title-only hits).
  const { data: titlePosts } = await db
    .from('community_posts')
    .select('id, title, body_text, created_at, community_spaces(slug, name)')
    .eq('status', 'published')
    .ilike('title', `%${q}%`)
    .limit(10)

  const allPosts = [
    ...(posts ?? []),
    ...((titlePosts ?? []).filter((p) => !(posts ?? []).find((x) => x.id === p.id))),
  ].slice(0, 10)

  return NextResponse.json({ posts: allPosts, resources: resources ?? [] })
}
