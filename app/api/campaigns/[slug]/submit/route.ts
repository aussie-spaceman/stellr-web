import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { sendEmail, campaignProposalReceivedEmail } from '@/lib/email'
import { deadlineInfo } from '@/lib/campaigns'
import { assertNotImpersonating } from '@/lib/impersonation'
import { claimUpload } from '@/lib/uploads'
import { watermarkIfPdf } from '@/lib/resource-finalise'

// Claiming a stored upload re-reads and may rewrite it (watermark).
export const maxDuration = 60


// Upload + submit a campaign proposal (file + optional judges' notes). One
// deliverable per registration; re-submitting replaces the stored file.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

    const member = await getCurrentMember()
    if (!member) return NextResponse.json({ error: 'You need to be signed in.' }, { status: 401 })

    const reg = await getMemberCampaignRegistration(member.id, slug)
    if (!reg) return NextResponse.json({ error: 'You are not registered for this campaign.' }, { status: 404 })

    // The bytes went browser → storage via /api/uploads/sign; only the path
    // arrives here. The 25MB this route used to advertise was never reachable —
    // the platform rejected any body over 4.5MB before the function ran.
    const b = await req.json().catch(() => ({}))
    const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
    const fileName = typeof b.fileName === 'string' ? b.fileName : ''
    const fileType = typeof b.fileType === 'string' ? b.fileType : ''
    const notes = (typeof b.notes === 'string' ? b.notes : '').trim() || null
    if (!storagePath || !fileName) {
      return NextResponse.json({ error: 'Attach a file to submit.' }, { status: 400 })
    }
    // Signed against this member's own registration; refuse anything else.
    if (!storagePath.startsWith(`${slug}/${reg.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const db = supabaseServer()
    const claimed = await claimUpload({ purpose: 'campaign-proposal', storagePath })
    if ('error' in claimed) {
      return NextResponse.json({ error: claimed.error }, { status: claimed.status })
    }

    // Watermark PDFs in place; store other formats as-is.
    await watermarkIfPdf(claimed.bucket, storagePath, claimed.bytes, fileType)

    const { error: updateError } = await db
      .from('registrations')
      .update({
        proposal_storage_path: storagePath,
        proposal_file_name: fileName,
        proposal_notes: notes,
        proposal_submitted_at: new Date().toISOString(),
      })
      .eq('id', reg.id)
    if (updateError) {
      console.error('[campaigns/submit] update error:', updateError)
      return NextResponse.json({ error: 'Could not record your submission.' }, { status: 500 })
    }

    // Confirmation email (best-effort).
    if (member.email) {
      try {
        const campaign = await getEventBySlug(slug).catch(() => null)
        const content = campaignProposalReceivedEmail({
          contactFirstName: member.first_name ?? reg.group_name ?? 'there',
          campaignTitle: (campaign?.title as string) ?? reg.event_title,
          fileName,
          deadlineLabel: deadlineInfo(campaign?.deadline)?.label ?? 'the',
        })
        await sendEmail({ to: member.email, ...content })
      } catch (err) {
        console.error('[campaigns/submit] email send failed:', err)
      }
    }

    return NextResponse.json({ ok: true, fileName })
  } catch (err) {
    console.error('[campaigns/submit] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
