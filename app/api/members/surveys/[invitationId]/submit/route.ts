import { handleSubmit } from '@/lib/survey/handlers'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/members/surveys/[invitationId]/submit — submit from the dashboard.
export async function POST(req: Request, ctx: { params: Promise<{ invitationId: string }> }) {
  return audited(req, { action: 'member.survey.submit', table: 'survey_invitations' }, () => submitSurvey(req, ctx))
}

async function submitSurvey(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params
  noteAudit(req, { targetId: invitationId })
  return handleSubmit(req, { invitationId })
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
