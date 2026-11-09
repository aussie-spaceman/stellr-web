import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { executeDeletion, DeletionBlockedError } from '@/lib/deletion/execute'
import { memberIdForClerkUser } from '@/lib/deletion/actor'
import { getEntityDef } from '@/lib/deletion/registry'
import { withAudit } from '@/lib/audit/route'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const audited = new WeakMap<Request, { entity: string; id: string; mode: string; refundChoice?: string; userId: string | null }>()

export const DELETE = withAudit(
  ({ args: [req] }) => {
    const a = audited.get(req)
    const def = a && getEntityDef(a.entity)
    return {
      action: 'deletion.entity.delete',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: def?.table ?? 'unknown', id: a?.id ?? null },
      metadata: {
        entity: a?.entity ?? null,
        mode: a?.mode ?? null,
        refundChoice: a?.refundChoice ?? null,
        // An event is keyed by its slug, which is not stored as a target id.
        ...(a && def?.keyType === 'slug' ? { eventSlug: a.id } : {}),
      },
    }
  },
  deleteEntity,
)

// DELETE /api/admin/deletion  { entity, id, mode: 'soft' | 'hard', refundChoice?: 'cash' | 'none', refundNote? }
// Central admin delete. Blocks (409) with the dependent list when linked records
// remain; otherwise runs external cleanup + soft/hard delete.
async function deleteEntity(req: Request) {
  const { userId, sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => null)
  const entity = body?.entity as string | undefined
  const id = body?.id as string | undefined
  const mode = (body?.mode as string | undefined) === 'hard' ? 'hard' : 'soft'
  const refundChoice = ['cash', 'none'].includes(body?.refundChoice) ? body.refundChoice : undefined
  const refundNote = typeof body?.refundNote === 'string' ? body.refundNote.trim().slice(0, 500) : ''
  if (!entity || !id) return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })
  // "No refund — remove only" skips the refund policy, so it must say why.
  if (refundChoice === 'none' && !refundNote) {
    return NextResponse.json({ error: 'A reason is required to remove a registration without a refund' }, { status: 400 })
  }

  audited.set(req, { entity, id, mode, refundChoice, userId })
  const deletedBy = await memberIdForClerkUser(userId)

  try {
    const result = await executeDeletion(entity, id, { mode, deletedBy, refundChoice, refundNote: refundNote || null })
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
