import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

// GET /api/admin/deletion-requests?status=pending — review queue for the
// Activity Review Log.
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  const db = supabaseServer()

  const { data, error } = await db
    .from('deletion_requests')
    .select('id, entity_type, entity_id, reason, status, created_at, requested_by, members:requested_by(first_name, last_name, email)')
    .eq('status', status)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Deletion requests list error:', error)
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 })
  }
  return NextResponse.json({ requests: data ?? [] })
}
