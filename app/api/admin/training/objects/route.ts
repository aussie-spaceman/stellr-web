import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { listTrainableObjects } from '@/lib/training-admin'

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// GET /api/admin/training/objects?scope=all|assigned
// Trainable Objects for the assignment picker (all) or tracking picker (assigned).
export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const scope = new URL(req.url).searchParams.get('scope') === 'assigned' ? 'assigned' : 'all'
  const objects = await listTrainableObjects(scope)
  return NextResponse.json({ objects })
}
