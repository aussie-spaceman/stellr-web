import { handleOpen, handleSave } from '@/lib/survey/handlers'
import { withAudit } from '@/lib/audit/route'
import { auditSubject } from '@/lib/audit/route-subject'

// /api/survey/[token] — the emailed survey link's API (lib/survey/access.ts).
// Works signed out. GET opens the survey; PATCH autosaves the draft.
//
// Another host's link answers as an unknown one (S5 A10b, lib/survey/http.ts). Each
// answer is audited on the survey's tenant's chain; the actor is whoever is signed in,
// if anyone, since the link works signed out.
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ token: string }> }

export const GET = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'survey.response.open', ...auditSubject(req, 'survey_invitations'), actor: { session: true } }),
  async (req: Request, { params }: Ctx) => handleOpen(req, { token: (await params).token }),
)

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, Ctx] }) => ({ action: 'survey.response.save', ...auditSubject(req, 'survey_invitations'), actor: { session: true } }),
  async (req: Request, { params }: Ctx) => handleSave(req, { token: (await params).token }),
)
