import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { notifyMember } from '@/lib/notify'

// POST /api/admin/training/bulk-notify
// Body: { memberIds: string[], objectLabel?: string, channels?: { email?, sms? } }
// Sends a training reminder to selected incomplete participants. Delivery honours
// each member's notification prefs across in-app / email / SMS; the channels hint
// records the admin's intent in the message.
async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  const memberIds: string[] = Array.isArray(b.memberIds) ? b.memberIds : []
  if (memberIds.length === 0) return NextResponse.json({ error: 'memberIds required' }, { status: 400 })
  const label = typeof b.objectLabel === 'string' && b.objectLabel ? b.objectLabel : 'your event'

  await Promise.all(
    memberIds.map((memberId) =>
      notifyMember(memberId, {
        type: 'session_reminder',
        body: `Reminder: please complete your required training for ${label}.`,
        email: {
          subject: 'Required training reminder',
          html: `<p>Hi,</p><p>This is a reminder to complete your required training for <strong>${label}</strong>. Sign in to Stellr and open Academy &rsaquo; Training.</p>`,
          text: `Reminder: complete your required training for ${label}.`,
        },
      })
    )
  )
  return NextResponse.json({ notified: memberIds.length })
}
