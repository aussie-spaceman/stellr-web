import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { loadMemberDigest } from '@/lib/admin-digest'
import { renderDigestEmail } from '@/lib/admin-digest-email'
import { appUrl } from '@/lib/email-campaigns'
import { sendEmail } from '@/lib/email'
import { maskEmail } from '@/lib/utils'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/admin/digest/send — email this week's digest (the Friday email,
// app/api/cron/weekly-digest) to the signed-in admin, and nobody else, so it
// can be checked on demand. Outside production lib/email reroutes it to the
// dev safelist, as it does every send.
export async function POST() {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const user = await currentUser().catch(() => null)
  const to = user?.primaryEmailAddress?.emailAddress
  if (!to) return NextResponse.json({ error: 'Your account has no email address.' }, { status: 400 })

  try {
    const digest = await loadMemberDigest(7)
    const email = renderDigestEmail(digest, { appUrl: appUrl() })
    await sendEmail({ to, subject: `[Preview] ${email.subject}`, html: email.html, text: email.text })
    return NextResponse.json({ sentTo: maskEmail(to) })
  } catch (err) {
    console.error('[admin/digest/send] failed:', err)
    return NextResponse.json({ error: 'The digest couldn’t be sent. Try again in a minute.' }, { status: 500 })
  }
}
