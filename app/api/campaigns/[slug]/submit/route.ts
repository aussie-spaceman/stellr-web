import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getEventBySlug } from '@/lib/sanity'
import { getCurrentMember } from '@/lib/community'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { sendEmail, campaignProposalReceivedEmail } from '@/lib/email'
import { deadlineInfo } from '@/lib/campaigns'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'

const BUCKET = 'campaign-proposals'
const MAX_BYTES = 25 * 1024 * 1024 // 25 MB

// Upload + submit a campaign proposal (file + optional judges' notes). One
// deliverable per registration; re-submitting replaces the stored file.
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const member = await getCurrentMember()
    if (!member) return NextResponse.json({ error: 'You need to be signed in.' }, { status: 401 })

    const reg = await getMemberCampaignRegistration(member.id, slug)
    if (!reg) return NextResponse.json({ error: 'You are not registered for this campaign.' }, { status: 404 })

    const form = await req.formData()
    const file = form.get('file') as File | null
    const notes = (form.get('notes') as string | null)?.trim() || null
    if (!file) return NextResponse.json({ error: 'Attach a file to submit.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File is larger than 25 MB.' }, { status: 400 })

    const db = supabaseServer()
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `${slug}/${reg.id}/${Date.now()}-${safeName}`

    // Watermark PDFs; store other formats as-is.
    let payload: Uint8Array | ArrayBuffer = await file.arrayBuffer()
    if (isPdf(file.name, file.type)) {
      try {
        payload = new Uint8Array(await stampPdfBytes(new Uint8Array(payload as ArrayBuffer)))
      } catch (err) {
        console.error('[campaigns/submit] watermark failed, storing original:', err)
      }
    }

    const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, payload, {
      contentType: file.type || 'application/octet-stream',
      upsert: true,
    })
    if (uploadError) {
      console.error('[campaigns/submit] upload error:', uploadError)
      return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
    }

    const { error: updateError } = await db
      .from('registrations')
      .update({
        proposal_storage_path: storagePath,
        proposal_file_name: file.name,
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
          fileName: file.name,
          deadlineLabel: deadlineInfo(campaign?.deadline)?.label ?? 'the',
        })
        await sendEmail({ to: member.email, ...content })
      } catch (err) {
        console.error('[campaigns/submit] email send failed:', err)
      }
    }

    return NextResponse.json({ ok: true, fileName: file.name })
  } catch (err) {
    console.error('[campaigns/submit] error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
