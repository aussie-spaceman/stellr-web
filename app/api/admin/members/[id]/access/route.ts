import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getMemberAccessSummary } from '@/lib/member-access'

// GET /api/admin/members/[id]/access — the member's roster-based access summary
// (competitions / cohorts / coaching), for the "all access in one place" panel.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const summary = await getMemberAccessSummary(id)
  return NextResponse.json(summary)
}
