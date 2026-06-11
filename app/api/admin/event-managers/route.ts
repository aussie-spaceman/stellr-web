import { auth, clerkClient } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

// Admin-only management of Event Manager → event assignments.
// Event Managers cannot manage assignments, only admins.

// GET /api/admin/event-managers?event_slug=... — list assignments (optionally per event)
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const eventSlug = new URL(req.url).searchParams.get('event_slug')
  const db = supabaseServer()
  let query = db
    .from('event_manager_assignments')
    .select('id, clerk_user_id, event_slug, created_at')
    .order('created_at', { ascending: true })
  if (eventSlug) query = query.eq('event_slug', eventSlug)

  const { data, error } = await query
  if (error) {
    console.error('Event manager assignments fetch error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ assignments: data ?? [] })
}

// POST /api/admin/event-managers — assign a manager
// Body: { event_slug } plus either { clerk_user_id } or { email } (resolved via Clerk).
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  let clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : ''
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  const eventSlug = typeof body?.event_slug === 'string' ? body.event_slug.trim() : ''
  if ((!clerkUserId && !email) || !eventSlug) {
    return NextResponse.json({ error: 'event_slug and clerk_user_id or email are required' }, { status: 400 })
  }

  if (!clerkUserId) {
    const client = await clerkClient()
    const { data: users } = await client.users.getUserList({ emailAddress: [email] })
    if (users.length === 0) {
      return NextResponse.json({ error: `No account found for ${email}` }, { status: 404 })
    }
    clerkUserId = users[0].id
  }

  const db = supabaseServer()
  const { data, error } = await db
    .from('event_manager_assignments')
    .upsert(
      { clerk_user_id: clerkUserId, event_slug: eventSlug },
      { onConflict: 'clerk_user_id,event_slug', ignoreDuplicates: true }
    )
    .select('id, clerk_user_id, event_slug')
    .maybeSingle()

  if (error) {
    console.error('Event manager assignment insert error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ assignment: data }, { status: 201 })
}

// DELETE /api/admin/event-managers — remove an assignment { clerk_user_id, event_slug }
export async function DELETE(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const clerkUserId = typeof body?.clerk_user_id === 'string' ? body.clerk_user_id.trim() : ''
  const eventSlug = typeof body?.event_slug === 'string' ? body.event_slug.trim() : ''
  if (!clerkUserId || !eventSlug) {
    return NextResponse.json({ error: 'clerk_user_id and event_slug are required' }, { status: 400 })
  }

  const db = supabaseServer()
  const { error } = await db
    .from('event_manager_assignments')
    .delete()
    .eq('clerk_user_id', clerkUserId)
    .eq('event_slug', eventSlug)

  if (error) {
    console.error('Event manager assignment delete error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
