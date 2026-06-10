import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isAdminClaims } from '@/lib/admin-auth'
import { resolveAudience, type Audience } from '@/lib/email-campaigns'

const schema = z.object({
  activeOnly: z.boolean().optional(),
  excludeMinors: z.boolean().optional(),
  tierIds: z.array(z.string().uuid()).nullable().optional(),
})

// POST /api/admin/email/audience/preview — recipient count for a filter, with
// consent suppression applied. Lets the campaign form show reach before sending.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  try {
    const members = await resolveAudience(parsed.data as Audience)
    return NextResponse.json({ count: members.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}
