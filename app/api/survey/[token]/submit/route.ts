import { handleSubmit } from '@/lib/survey/handlers'
import { withAudit } from '@/lib/audit/route'
import { auditSubject } from '@/lib/audit/route-subject'

// POST /api/survey/[token]/submit — submit and freeze the response.
// Another host's link answers as an unknown one (S5 A10b, lib/survey/http.ts).
export const POST = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ token: string }> }] }) => ({
    action: 'survey.response.submit',
    ...auditSubject(req, 'survey_invitations'),
    actor: { session: true },
  }),
  async (req: Request, { params }: { params: Promise<{ token: string }> }) => handleSubmit(req, { token: (await params).token }),
)
