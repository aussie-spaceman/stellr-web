import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getItemDownload } from '@/lib/training'

// GET /api/community/training/items/[id]/download
// Validates the member's access to the item's module, then returns a short-lived
// signed URL for the underlying video/document (FR-COM-10). The storage path is
// never exposed to the client.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const result = await getItemDownload(member, id)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result)
}
