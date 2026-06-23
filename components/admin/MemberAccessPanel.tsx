'use client'

import { useEffect, useState } from 'react'
import { Trophy, Users, MessageCircle } from 'lucide-react'

interface Summary {
  competitions: { slug: string; label: string }[]
  mentoring: { label: string; relationship: string; archived: boolean }[]
  coaching: { label: string; relationship: string }[]
}

// "All access in one place" (P3). Read-only roster access for a member —
// competitions, mentoring cohorts, coaching — surfaced on the member admin page so
// an admin can answer "what can this person get into?" without hunting across
// screens. Membership tiers + event activity live in the panels alongside this.
export function MemberAccessPanel({ memberId }: { memberId: string }) {
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/members/${memberId}/access`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && setData(j))
    return () => {
      active = false
    }
  }, [memberId])

  const empty =
    data && data.competitions.length === 0 && data.mentoring.length === 0 && data.coaching.length === 0

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted-soft">
        Access (spaces &amp; rosters)
      </h2>
      {!data ? (
        <p className="text-xs text-brand-muted-soft">Loading…</p>
      ) : empty ? (
        <p className="text-xs text-brand-muted-soft">
          Not on any competition, cohort or coaching roster yet.
        </p>
      ) : (
        <div className="space-y-3">
          {data.competitions.length > 0 && (
            <Group icon={<Trophy className="h-4 w-4 text-brand-gold-ink" />} title="Competitions">
              {data.competitions.map((c) => (
                <Row key={c.slug} label={c.label} />
              ))}
            </Group>
          )}
          {data.mentoring.length > 0 && (
            <Group icon={<Users className="h-4 w-4 text-brand-blue" />} title="Mentoring cohorts">
              {data.mentoring.map((m, i) => (
                <Row
                  key={i}
                  label={m.label}
                  tag={m.relationship !== 'participant' ? m.relationship : m.archived ? 'archived' : null}
                />
              ))}
            </Group>
          )}
          {data.coaching.length > 0 && (
            <Group icon={<MessageCircle className="h-4 w-4 text-brand-teal" />} title="Coaching">
              {data.coaching.map((c, i) => (
                <Row key={i} label={c.label} tag={c.relationship !== 'participant' ? c.relationship : null} />
              ))}
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

function Group({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand-muted">
        {icon}
        {title}
      </div>
      <ul className="space-y-1">{children}</ul>
    </div>
  )
}

function Row({ label, tag }: { label: string; tag?: string | null }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-brand-hairline px-2.5 py-1 text-sm">
      <span className="truncate text-brand-blue-dark">{label}</span>
      {tag && (
        <span className="shrink-0 rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] font-medium uppercase text-brand-muted">
          {tag}
        </span>
      )}
    </li>
  )
}
