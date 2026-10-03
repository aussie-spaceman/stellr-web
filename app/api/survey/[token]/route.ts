import { handleOpen, handleSave } from '@/lib/survey/handlers'

// /api/survey/[token] — the emailed survey link's API (lib/survey/access.ts).
// Works signed out. GET opens the survey; PATCH autosaves the draft.
export const dynamic = 'force-dynamic'

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleOpen(req, { token: (await params).token })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleSave(req, { token: (await params).token })
}
