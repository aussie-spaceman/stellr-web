import { supabaseServer } from '@/lib/supabase'
import { AccessConsole } from '@/components/admin/access/AccessConsole'
import type { RuleRow, TierOption } from '@/components/admin/membership/RulesClient'
import { listDiscounts, listTiers, listTierBenefits } from '@/lib/entitlements'

export const metadata = { title: 'Admin — Access' }
export const dynamic = 'force-dynamic'

// The converged admin/access console (design/admin-access handover). People /
// Objects / Rules / Discounts over one resolver: staff RBAC → object roster →
// membership tier, then payment ∧ DocuSign gates. Replaces the per-type admin
// surfaces listed in RETIREMENT-DIFF.md, and the retired Membership Studio.

const TAB_MAP: Record<string, 'people' | 'objects' | 'rules' | 'discounts'> = {
  objects: 'objects', rules: 'rules', discounts: 'discounts', people: 'people',
}

export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const db = supabaseServer()

  const [{ data: rules }, { data: tiers }, discounts, discountTiers, allocations] = await Promise.all([
    db.from('tier_grant_rules').select('*').order('trigger_type').order('priority', { ascending: false }),
    db.from('membership_tiers').select('id, name, is_free').order('sort_order'),
    listDiscounts(),
    listTiers(),
    listTierBenefits(),
  ])

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-brand-blue-dark">Access</h1>
      <p className="mb-6 text-sm text-brand-muted-soft">
        Who can reach what, and why — people, objects and the rules that connect them.
      </p>
      <AccessConsole
        initialRules={(rules ?? []) as RuleRow[]}
        tiers={(tiers ?? []) as TierOption[]}
        discounts={discounts}
        discountTiers={discountTiers}
        allocations={allocations}
        initialTab={TAB_MAP[tab ?? ''] ?? 'people'}
      />
    </div>
  )
}
