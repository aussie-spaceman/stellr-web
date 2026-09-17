import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveAccessObject } from '@/lib/access-objects'
import { isAdminClaims } from '@/lib/admin-auth'

// GET /api/admin/access/objects/[id] — resolve any object ref (container uuid,
// space uuid, module uuid, resource uuid, or event slug) to its canonical
// admin/access shape. The container-detail shell loads this first, then the
// roster/managers/contents/gates sub-routes.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })
  return NextResponse.json({ object })
}
