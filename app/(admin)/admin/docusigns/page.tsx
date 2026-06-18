import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { DocusignTable, type EnvelopeRow } from '@/components/admin/DocusignTable'

export const metadata = { title: 'Admin — Consent Forms' }

export default async function AdminDocusignsPage() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  const db = supabaseServer()

  const { data: envelopes } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, declined_at, reminder_sent_at, participant_id, member_id, reused_from')
    .order('sent_at', { ascending: false })

  const pending   = (envelopes ?? []).filter(e => e.status === 'sent' || e.status === 'delivered').length
  const completed = (envelopes ?? []).filter(e => e.status === 'completed').length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Consent Forms</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">
            DocuSign parental consent for minor event participants.
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

      <DocusignTable initial={(envelopes ?? []) as EnvelopeRow[]} />
    </div>
  )
}
