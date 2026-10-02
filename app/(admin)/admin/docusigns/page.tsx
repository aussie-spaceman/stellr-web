import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { DocusignTable, type EnvelopeRow } from '@/components/admin/DocusignTable'
import { EsignEngineCard } from '@/components/admin/EsignEngineCard'
import { NeedsPaperwork } from '@/components/admin/NeedsPaperwork'
import { loadPaperworkGaps } from '@/lib/esign/needs-paperwork'
import { loadRecipientsByEnvelopeRows } from '@/lib/docusign-recipients'

export const metadata = { title: 'Admin — Consent Forms' }

export default async function AdminDocusignsPage() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  const db = supabaseServer()

  // signers_total / signers_completed were missing from this select, so a
  // 1-of-2 envelope rendered as a flat "Awaiting signature" here while the
  // roster called the same row "Partially Complete" (4 Sept 2026).
  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, provider, status, envelope_type, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, declined_at, reminder_sent_at, reminder_count, participant_id, member_id, reused_from, signers_total, signers_completed, credential_sharing_opt_out')
    .order('sent_at', { ascending: false })

  const recipientsByEnvelope = await loadRecipientsByEnvelopeRows(
    db,
    (envelopes ?? []).map(e => e.id as string),
  )
  const rows = (envelopes ?? []).map(e => ({
    ...e,
    recipients: recipientsByEnvelope.get(e.id as string) ?? [],
  })) as EnvelopeRow[]

  // A failed lookup must not take the whole page down: the list just shows empty.
  const gaps = await loadPaperworkGaps(db).catch((err) => {
    console.error('[admin/docusigns] needs-paperwork lookup failed:', err)
    return []
  })

  const pending   = (envelopes ?? []).filter(e => e.status === 'sent' || e.status === 'delivered').length
  const completed = (envelopes ?? []).filter(e => e.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Consent Forms</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">
            Signed agreements for event participants, volunteers and members, from DocuSign and Stellr signing.
          </p>
          <p className="text-sm mt-1">
            <Link href="/admin/docusigns/templates" className="text-primary underline">Agreement documents</Link>
          </p>
        </div>
        <div className="flex gap-4 text-sm text-right">
          <div>
            <p className="text-2xl font-bold text-amber-600">{pending}</p>
            <p className="text-xs text-brand-muted-soft">Awaiting signature</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">{completed}</p>
            <p className="text-xs text-brand-muted-soft">Signed</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-brand-muted">{(envelopes ?? []).length}</p>
            <p className="text-xs text-brand-muted-soft">Total</p>
          </div>
        </div>
      </div>

      <EsignEngineCard />

      <NeedsPaperwork gaps={gaps} />

      <DocusignTable initial={rows} />
    </div>
  )
}
