import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { impersonatedMemberId } from '@/lib/impersonation'
import { loadRecipientsByEnvelopeRows } from '@/lib/docusign-recipients'
import { ISSUE_FAILED_PREFIX } from '@/lib/docusign-agreements'
import { signNowUrlFor } from '@/lib/esign/outbox'

// GET /api/members/docusigns — returns DocuSign envelopes for the current member
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  // Honours an admin view-as session, so the portal shows THIS member's
  // envelopes rather than the admin's own (usually empty) list.
  const viewAsId = await impersonatedMemberId()
  const { data: member } = viewAsId
    ? await db.from('members').select('id').eq('id', viewAsId).maybeSingle()
    : await db
        .from('members')
        .select('id')
        .eq('clerk_user_id', userId)
        .eq('is_active', true)
        .maybeSingle()

  if (!member) return NextResponse.json({ envelopes: [] })

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, provider, status, envelope_type, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, reminder_sent_at, reused_from, signers_total, signers_completed')
    .eq('member_id', member.id)
    // Kept only for legal claims after a deletion request: not shown.
    .is('restricted_at', null)
    // An internal marker for an issue that failed; the member sees nothing until it is re-issued.
    .not('envelope_id', 'like', `${ISSUE_FAILED_PREFIX}%`)
    .order('sent_at', { ascending: false })

  // Per-recipient state so the portal can tell a family WHICH signature is
  // outstanding — the question that prompted all of this (4 Sept 2026).
  const recipientsByEnvelope = await loadRecipientsByEnvelopeRows(
    db,
    (envelopes ?? []).map(e => e.id as string),
  )

  // On Stellr signing, a member whose turn it is can sign from here instead of
  // hunting for the email. Never while an admin is viewing as them.
  const signNow = new Map<string, string>()
  if (!viewAsId) {
    const nativeIds = (envelopes ?? []).filter(e => e.provider === 'native' && ['sent', 'delivered'].includes(e.status as string)).map(e => e.id as string)
    if (nativeIds.length) {
      const { data: mine } = await db
        .from('docusign_envelope_recipients')
        .select('id, envelope_row, token_version, token_expires_at, status')
        .in('envelope_row', nativeIds)
        .eq('member_id', member.id)
        .in('status', ['sent', 'delivered'])
      for (const r of (mine ?? []) as { id: string; envelope_row: string; token_version: number; token_expires_at: string | null }[]) {
        signNow.set(r.envelope_row, signNowUrlFor(r))
      }
    }
  }

  return NextResponse.json({
    envelopes: (envelopes ?? []).map(e => ({
      ...e,
      recipients: recipientsByEnvelope.get(e.id as string) ?? [],
      signNowUrl: signNow.get(e.id as string) ?? null,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
