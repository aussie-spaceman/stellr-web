import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { executeDeletion, DeletionBlockedError } from '@/lib/deletion/execute'
import { memberIdForClerkUser } from '@/lib/deletion/actor'

// DELETE /api/admin/deletion  { entity, id, mode: 'soft' | 'hard' }
// Central admin delete. Blocks (409) with the dependent list when linked records
// remain; otherwise runs external cleanup + soft/hard delete.
export async function DELETE(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const entity = body?.entity as string | undefined
  const id = body?.id as string | undefined
  const mode = (body?.mode as string | undefined) === 'hard' ? 'hard' : 'soft'
  if (!entity || !id) return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })

  const deletedBy = await memberIdForClerkUser(userId)

  try {
    const result = await executeDeletion(entity, id, { mode, deletedBy })
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof DeletionBlockedError) {
      return NextResponse.json({ error: 'Deletion blocked', blockers: e.blockers }, { status: 409 })
    }
    const msg = e instanceof Error ? e.message : 'Deletion failed'
    const status = msg.startsWith('Unknown deletable') ? 400 : 500
    console.error('Admin deletion error:', msg)
    return NextResponse.json({ error: msg }, { status })
  }
}
