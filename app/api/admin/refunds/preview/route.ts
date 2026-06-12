import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { previewRefund } from '@/lib/refunds/preview'

// GET /api/admin/refunds/preview?participant=<id>
// Powers the refund choice in the delete dialog (cash/credit options, amounts).
export async function GET(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const participant = new URL(req.url).searchParams.get('participant')
  if (!participant) return NextResponse.json({ error: 'participant is required' }, { status: 400 })

  try {
    const preview = await previewRefund(participant)
    return NextResponse.json(preview)
  } catch (e) {
    console.error('Refund preview error:', e)
    return NextResponse.json({ error: 'Preview failed' }, { status: 500 })
  }
}
