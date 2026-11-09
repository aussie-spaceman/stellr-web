import { handleOpen, handleSave } from '@/lib/survey/handlers'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// /api/members/surveys/[invitationId] — a signed-in member's survey, opened
// from the dashboard. GET opens it; PATCH autosaves. Read-only while an admin
// is viewing as the member.
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ invitationId: string }> }) {
  return audited(req, { action: 'member.survey.open', table: 'survey_invitations' }, () => openSurvey(req, ctx))
}

async function openSurvey(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params
  noteAudit(req, { targetId: invitationId })
  return handleOpen(req, { invitationId })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ invitationId: string }> }) {
  return audited(req, { action: 'member.survey.save', table: 'survey_invitations' }, () => saveSurvey(req, ctx))
}

async function saveSurvey(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params
  noteAudit(req, { targetId: invitationId })
  return handleSave(req, { invitationId })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
