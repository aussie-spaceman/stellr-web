import { supabaseServer } from '@/lib/supabase'
import { DEFAULT_TIERS, type RefundTier } from '@/lib/refunds/policy'
import { RefundPolicyEditor } from '@/components/admin/RefundPolicyEditor'
import Link from 'next/link'

export const metadata = { title: 'Admin — Refund Policy' }

export default async function RefundPolicyPage() {
  const db = supabaseServer()
  const { data } = await db.from('refund_policies').select('tiers').eq('scope', 'global').maybeSingle()
  const tiers = (data?.tiers as RefundTier[]) ?? DEFAULT_TIERS

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link href="/admin/competitions" className="text-sm text-brand-muted-soft hover:text-brand-muted mb-1 inline-block">← Events</Link>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Refund Policy</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          The global default applied when a paid registration is cancelled. Individual events can override this from the event page.
        </p>
      </div>
      <div className="bg-white rounded-xl border border-brand-border p-5">
        <RefundPolicyEditor scope="global" initialTiers={tiers} />
      </div>
    </div>
  )
}
