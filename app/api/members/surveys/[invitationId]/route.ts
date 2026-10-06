import { handleOpen, handleSave } from '@/lib/survey/handlers'

// /api/members/surveys/[invitationId] — a signed-in member's survey, opened
// from the dashboard. GET opens it; PATCH autosaves. Read-only while an admin
// is viewing as the member.
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  return handleOpen(req, { invitationId: (await params).invitationId })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  return handleSave(req, { invitationId: (await params).invitationId })
}
