import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

// DELETE /api/admin/event-participations/[id] — admin deletes any event record
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { error } = await db
    .from('event_participations')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Admin event participation delete error:', error)
    return NextResponse.json({ error: 'Failed to delete record' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
