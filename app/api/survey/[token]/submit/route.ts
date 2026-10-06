import { handleSubmit } from '@/lib/survey/handlers'

// POST /api/survey/[token]/submit — submit and freeze the response.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handleSubmit(req, { token: (await params).token })
}
