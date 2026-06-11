import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { deletionPreflight } from '@/lib/deletion/preflight'

// GET /api/admin/deletion/preflight?entity=&id=
// Returns the blocking dependents that must be deleted before this item can go.
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity')
  const id = searchParams.get('id')
  if (!entity || !id) return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })

  try {
    const result = await deletionPreflight(entity, id)
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Preflight failed'
    const status = msg.startsWith('Unknown deletable') ? 400 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
