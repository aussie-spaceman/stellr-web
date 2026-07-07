'use client'

import { useState } from 'react'
import { Users, Boxes, GitBranch } from 'lucide-react'
import { RulesClient, type RuleRow, type TierOption } from '@/components/admin/membership/RulesClient'
import { PeopleTab } from './PeopleTab'
import { ObjectsTab } from './ObjectsTab'
import { RelationshipMatrix } from './RelationshipMatrix'
import { ConflictsPanel } from './ConflictsPanel'

// The converged admin/access console (design/admin-access). Three tabs over one
// model: People (Person 360), Objects (unified container detail), Rules (grant
// rules + the relationship matrix). Replaces the per-type admin surfaces listed
// in RETIREMENT-DIFF.md.

type Tab = 'people' | 'objects' | 'rules'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'people', label: 'People', icon: <Users className="h-4 w-4" /> },
  { id: 'objects', label: 'Objects', icon: <Boxes className="h-4 w-4" /> },
  { id: 'rules', label: 'Rules', icon: <GitBranch className="h-4 w-4" /> },
]

export function AccessConsole({
  initialRules,
  tiers,
  initialTab,
}: {
  initialRules: RuleRow[]
  tiers: TierOption[]
  initialTab?: Tab
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'people')
  const [jumpRef, setJumpRef] = useState<string | null>(null)

  const jumpToObject = (ref: string) => {
    setJumpRef(ref)
    setTab('objects')
  }

  return (
    <div>
      <div className="mb-5 flex gap-1 rounded-lg border border-brand-border bg-white p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
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
    </div>
  )
}
