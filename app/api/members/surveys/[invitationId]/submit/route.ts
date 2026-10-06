import { handleSubmit } from '@/lib/survey/handlers'

// POST /api/members/surveys/[invitationId]/submit — submit from the dashboard.
export async function POST(req: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  return handleSubmit(req, { invitationId: (await params).invitationId })
}
