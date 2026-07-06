import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/admin/community/resources/search?q=…&limit=…
// Admin resource picker: search the Global Resources Catalogue (every stored
// binary) so an admin can attach an existing file to a Space instead of
// re-uploading. Returns lightweight rows; attach happens via the space
// `attach-resource` action, which reuses the same binary by reference.
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 20), 1), 50)

  const db = supabaseServer()
  let query = db
    .from('community_resources')
    .select('id, title, file_type, file_size_bytes, created_at')
    .not('storage_path', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (q) query = query.ilike('title', `%${q}%`)

  const { data, error } = await query
  if (error) {
    console.error('[admin] resource search error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const results = (data ?? []).map((r) => {
    const x = r as { id: string; title: string; file_type: string | null; file_size_bytes: number | null }
    return { id: x.id, title: x.title, fileType: x.file_type, sizeBytes: x.file_size_bytes }
  })
  return NextResponse.json({ results })
}
