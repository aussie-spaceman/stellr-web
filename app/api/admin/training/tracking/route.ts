import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getObjectTracking, type ObjectType } from '@/lib/training-admin'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

const OBJECT_TYPES: ObjectType[] = ['competition', 'campaign', 'cohort', 'workshop', 'space']

// GET /api/admin/training/tracking?objectType=&objectRef=&bracket=&outstanding=
// Per-participant mandatory-training completion for one Object (any type).
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const sp = new URL(req.url).searchParams
  const objectRef = sp.get('objectRef')
  const objectType = sp.get('objectType') as ObjectType | null
  if (!objectRef) return NextResponse.json({ error: 'objectRef required' }, { status: 400 })
  const tracking = await getObjectTracking(
    objectType && OBJECT_TYPES.includes(objectType) ? objectType : 'competition',
    objectRef,
    { bracket: sp.get('bracket') ?? 'all', outstanding: sp.get('outstanding') === '1' }
  )
  return NextResponse.json(tracking)
}
