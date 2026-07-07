'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Users, Boxes, GitBranch, Percent } from 'lucide-react'
import { RulesClient, type RuleRow, type TierOption } from '@/components/admin/membership/RulesClient'
import { DiscountsClient } from '@/components/admin/membership/DiscountsClient'
import type { Discount, Tier, TierBenefit } from '@/lib/entitlements'
import { PeopleTab } from './PeopleTab'
import { ObjectsTab } from './ObjectsTab'
import { RelationshipMatrix } from './RelationshipMatrix'
import { ConflictsPanel } from './ConflictsPanel'

// The converged admin/access console (design/admin-access). Tabs over one model:
// People (Person 360), Objects (unified container detail), Rules (grant rules +
// the relationship matrix), Discounts (per-tier discounts, moved here from the
// retired Membership Studio). Replaces the per-type admin surfaces listed in
// RETIREMENT-DIFF.md.
//
// The active tab is kept in the URL (?tab=) so browser Back returns to the prior
// tab instead of leaving the console — e.g. after People → "open" jumps to Objects.

type Tab = 'people' | 'objects' | 'rules' | 'discounts'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'people', label: 'People', icon: <Users className="h-4 w-4" /> },
  { id: 'objects', label: 'Objects', icon: <Boxes className="h-4 w-4" /> },
  { id: 'rules', label: 'Rules', icon: <GitBranch className="h-4 w-4" /> },
  { id: 'discounts', label: 'Discounts', icon: <Percent className="h-4 w-4" /> },
]

export function AccessConsole({
  initialRules,
  tiers,
  discounts,
  discountTiers,
  allocations,
  initialTab,
}: {
  initialRules: RuleRow[]
  tiers: TierOption[]
  discounts: Discount[]
  discountTiers: Tier[]
  allocations: TierBenefit[]
  initialTab?: Tab
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const tab: Tab = (params.get('tab') as Tab) || initialTab || 'people'
  const jumpRef = params.get('ref')

  const goToTab = (id: Tab, extra?: Record<string, string>) => {
    const next = new URLSearchParams()
    next.set('tab', id)
    for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v)
    router.push(`${pathname}?${next.toString()}`, { scroll: false })
  }

  const jumpToObject = (ref: string) => goToTab('objects', { ref })

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg border border-brand-border bg-white p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => goToTab(t.id)}
            className={
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ' +
              (tab === t.id
                ? 'bg-brand-blue text-white'
                : 'text-brand-muted hover:bg-brand-canvas')
            }
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'people' && <PeopleTab onJumpToObject={jumpToObject} />}
      {tab === 'objects' && <ObjectsTab initialRef={jumpRef} />}
      {tab === 'rules' && (
        <div className="grid gap-8 xl:grid-cols-[1fr_280px]">
          <div className="space-y-8">
            <RulesClient initialRules={initialRules} tiers={tiers} />
            <div>
              <h2 className="mb-2 text-sm font-semibold text-brand-blue-dark">Relationship matrix</h2>
              <p className="mb-3 text-xs text-brand-muted-soft">
                Which object types may be attached to which. Every attach — manual or rule-driven — is
                validated against this grid, server-side.
              </p>
              <RelationshipMatrix />
            </div>
          </div>
          <ConflictsPanel />
        </div>
      )}
      {tab === 'discounts' && (
        <DiscountsClient discounts={discounts} tiers={discountTiers} allocations={allocations} />
      )}
    </div>
  )
}
