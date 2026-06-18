import { supabaseServer } from '@/lib/supabase'
import { MembershipNav } from '../MembershipNav'
import { RulesClient, type RuleRow, type TierOption } from '@/components/admin/membership/RulesClient'

export const metadata = { title: 'Admin — Grant Rules' }
export const dynamic = 'force-dynamic'

// Membership Studio · Grant rules tab. CRUD over tier_grant_rules: "when
// <trigger> [matching <conditions>] grant <tier> for <duration>". The evaluator
// in lib/membership-grants.ts reads these whenever a trigger fires.
export default async function MembershipRulesPage() {
  const db = supabaseServer()
  const [{ data: rules }, { data: tiers }] = await Promise.all([
    db.from('tier_grant_rules').select('*').order('trigger_type').order('priority', { ascending: false }),
    db.from('membership_tiers').select('id, name, is_free').order('sort_order'),
  ])

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Membership Studio</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">
        Rules that automatically assign or upgrade a tier when something happens.
      </p>
      <MembershipNav />
      <RulesClient initialRules={(rules ?? []) as RuleRow[]} tiers={(tiers ?? []) as TierOption[]} />
    </div>
  )
}
