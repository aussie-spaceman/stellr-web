import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getEventTracking } from '@/lib/training-admin'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// GET /api/admin/training/tracking?objectRef=&bracket=&outstanding=
// Per-participant mandatory-training completion for one event Object.
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const objectRef = sp.get('objectRef')
  if (!objectRef) return NextResponse.json({ error: 'objectRef required' }, { status: 400 })
  const tracking = await getEventTracking(objectRef, {
    bracket: sp.get('bracket') ?? 'all',
    outstanding: sp.get('outstanding') === '1',
  })
  return NextResponse.json(tracking)
}
