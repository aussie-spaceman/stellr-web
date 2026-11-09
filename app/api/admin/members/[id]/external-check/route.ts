import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isStellrAdmin } from '@/lib/authz'
import { actorFromAuth } from '@/lib/activity-log'
import { auditMutation, withAudit } from '@/lib/audit/route'
import { LICENSE_DOCUMENT_URL_TTL_SECONDS } from '@/lib/teacher-license'
import {
  EXTERNAL_BC_BUCKET,
  EXTERNAL_BC_TABLE,
  deleteExternalCheck,
  externalCheckSchema,
  saveExternalCheck,
  setExternalCheckVerified,
} from '@/lib/external-background-check'

export const dynamic = 'force-dynamic'

const ROUTE = '/api/admin/members/[id]/external-check'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Admin handling of a background check a member already holds from another
// organisation. Admin only: event managers never reach this, and the document
// is served only through a 10-minute signed URL.
//
//   GET    → 302 to a signed URL for the document
//   POST   { action: 'save', issuer, completed_on, document_expires_on?, storagePath, fileType }
//          { action: 'verify', updatedAt }   (bound to the version reviewed, BG-9)
//          { action: 'unverify' }
//   DELETE → remove the check and its document

const bodySchema = z.discriminatedUnion('action', [
  externalCheckSchema.extend({ action: z.literal('save') }),
  z.object({ action: z.literal('verify'), updatedAt: z.string().min(1) }),
  z.object({ action: z.literal('unverify') }),
])

async function guard(params: Promise<{ id: string }>): Promise<{ id: string } | NextResponse> {
  if (!(await isStellrAdmin({ route: ROUTE }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  return { id }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const db = supabaseServer()
  const { data } = await db.from(EXTERNAL_BC_TABLE).select('document_path').eq('member_id', g.id).maybeSingle()
  const path = (data as { document_path?: string } | null)?.document_path
  if (!path) return NextResponse.json({ error: 'No uploaded background check on file' }, { status: 404 })
  const { data: signed } = await db.storage.from(EXTERNAL_BC_BUCKET).createSignedUrl(path, LICENSE_DOCUMENT_URL_TTL_SECONDS)
  if (!signed?.signedUrl) return NextResponse.json({ error: 'The document could not be opened. Try again.' }, { status: 502 })
  const res = NextResponse.redirect(signed.signedUrl, 302)
  res.headers.set('Cache-Control', 'private, no-store')
  return res
}

type Ctx = { params: Promise<{ id: string }> }
const memberTarget = (req: Request) => ({ table: 'members', id: new URL(req.url).pathname.split('/').at(-2) ?? null })

const deleteAudit = ({ args: [req] }: { args: [Request, Ctx] }) => ({
  action: 'compliance.external_check.remove' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: memberTarget(req),
  metadata: { via: 'admin' },
})

// Save and verify share POST, so each success records its own action
// (auditMutation) once the body says which it was.
export async function POST(req: Request, { params }: Ctx) {
  const g = await guard(params)
  if (g instanceof NextResponse) return g

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const fromForm = issue && issue.path[0] !== 'action' && issue.path[0] !== 'updatedAt'
    return NextResponse.json({ error: fromForm ? issue.message : 'Invalid request' }, { status: 400 })
  }

  const db = supabaseServer()
  const actor = await actorFromAuth()
  if (parsed.data.action === 'save') {
    const { data: member } = await db.from('members').select('id').eq('id', g.id).maybeSingle()
    if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    const { action: _action, ...input } = parsed.data
    const result = await saveExternalCheck(db, { memberId: g.id, input, purpose: 'external-bc-document-admin', submittedBy: 'admin', actor })
    await auditMutation(
      {
        action: 'compliance.external_check.submit',
        actor: { session: true },
        tenant: { stellr: true },
        target: memberTarget(req),
        metadata: { via: 'admin', status: result.ok ? 200 : result.status },
      },
      { afterResponse: true },
    )
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ok: true, updatedAt: result.updatedAt, validUntil: result.validUntil })
  }

  const verify = parsed.data.action === 'verify'
  const result = await setExternalCheckVerified(db, {
    memberId: g.id,
    verify,
    updatedAt: verify ? (parsed.data as { updatedAt: string }).updatedAt : undefined,
    actor,
  })
  await auditMutation(
    {
      action: 'compliance.external_check.verify',
      actor: { session: true },
      tenant: { stellr: true },
      target: memberTarget(req),
      metadata: { via: 'admin', verified: verify, status: result.ok ? 200 : result.status },
    },
    { afterResponse: true },
  )
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
}

export const DELETE = withAudit(deleteAudit, async (_req: Request, { params }: Ctx) => {
  const g = await guard(params)
  if (g instanceof NextResponse) return g
  const result = await deleteExternalCheck(supabaseServer(), { memberId: g.id, actor: await actorFromAuth(), byAdmin: true })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
})
