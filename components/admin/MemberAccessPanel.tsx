'use client'

import { useEffect, useState } from 'react'
import {
  Trophy, Users, MessageCircle, MessagesSquare, GraduationCap,
  BookOpen, FolderOpen, Building2, HelpCircle,
} from 'lucide-react'

type AccessObjectType =
  | 'space' | 'course' | 'workshop' | 'cohort' | 'event' | 'campaign' | 'resource' | 'group'

interface AccessSource {
  kind: 'roster' | 'manager' | 'tier' | 'role' | 'open' | 'object' | 'invited'
  label: string
}

interface EffectiveAccessRow {
  objectType: AccessObjectType
  objectRef: string
  label: string
  role: string
  archived: boolean
  sources: AccessSource[]
  redundant: boolean
}

interface Summary {
  competitions: { slug: string; label: string }[]
  mentoring: { label: string; relationship: string; archived: boolean }[]
  coaching: { label: string; relationship: string }[]
  rows: EffectiveAccessRow[]
}

// "All access in one place" (P3) — everything this member can currently get
// into, and what grants it.
//
// This used to render only the competition/cohort/coaching rosters while
// discarding `rows`, the unified resolution the API has always returned. The
// panel is headed "spaces & rosters" and was the one screen in the admin that
// never showed a Space: an admin looking at Bill Allen saw a competition called
// "Space Design Campaign - Fall 2027" — an event registration — and reasonably
// read it as a Space he had access to, while the six event Spaces he really
// could open were nowhere on the page.
//
// Showing WHY each grant exists matters as much as showing it. A Space reached
// through 'Rule (role)' is a member's org-wide role letting them in, which is
// almost never what an event Space is meant to mean; that distinction is
// invisible unless the source is on screen.

const GROUPS: { type: AccessObjectType; title: string; icon: React.ReactNode }[] = [
  { type: 'space', title: 'Spaces', icon: <MessagesSquare className="h-4 w-4 text-brand-teal" /> },
  { type: 'event', title: 'Competitions', icon: <Trophy className="h-4 w-4 text-brand-gold-ink" /> },
  { type: 'campaign', title: 'Campaigns', icon: <Trophy className="h-4 w-4 text-brand-gold-ink" /> },
  { type: 'cohort', title: 'Mentoring cohorts', icon: <Users className="h-4 w-4 text-brand-blue" /> },
  { type: 'workshop', title: 'Coaching', icon: <MessageCircle className="h-4 w-4 text-brand-teal" /> },
  { type: 'course', title: 'Training', icon: <GraduationCap className="h-4 w-4 text-brand-blue" /> },
  { type: 'resource', title: 'Resources', icon: <BookOpen className="h-4 w-4 text-brand-blue" /> },
  { type: 'group', title: 'Groups', icon: <Building2 className="h-4 w-4 text-brand-blue" /> },
]

/** Muted by default; a grant worth a second look is tinted. */
const SOURCE_TINT: Record<AccessSource['kind'], string> = {
  roster: 'bg-brand-hairline text-brand-muted',
  object: 'bg-brand-hairline text-brand-muted',
  manager: 'bg-[#EEF2FF] text-[#3730A3]',
  tier: 'bg-[#F0FDF4] text-[#166534]',
  role: 'bg-[#F6F2FF] text-[#5B3FD1]',
  open: 'bg-brand-hairline text-brand-muted',
  invited: 'bg-[#FFF7ED] text-[#9A3412]',
}

export function MemberAccessPanel({ memberId }: { memberId: string }) {
  const [data, setData] = useState<Summary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/members/${memberId}/access`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => active && setData(j))
      // This is an audit surface: an empty list and a failed request must not
      // look the same, or an admin concludes a grant is missing and re-grants it.
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [memberId])

  const rows = data?.rows ?? []
  const grouped = GROUPS
    .map((g) => ({ ...g, items: rows.filter((r) => r.objectType === g.type) }))
    .filter((g) => g.items.length > 0)
  const ungrouped = rows.filter((r) => !GROUPS.some((g) => g.type === r.objectType))

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted-soft">
        Access (spaces &amp; rosters)
      </h2>
      {failed ? (
        <p className="text-xs text-red-600">
          Couldn&apos;t load access. Reload before assuming this member has none.
        </p>
      ) : !data ? (
        <p className="text-xs text-brand-muted-soft">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">
          No Spaces, competitions, cohorts or coaching yet.
        </p>
      ) : (
        <div className="space-y-3">
          {grouped.map((g) => (
            <Group key={g.type} icon={g.icon} title={g.title}>
              {g.items.map((r) => (
                <Row key={`${r.objectType}:${r.objectRef}`} row={r} />
              ))}
            </Group>
          ))}
          {ungrouped.length > 0 && (
            <Group icon={<FolderOpen className="h-4 w-4 text-brand-muted" />} title="Other">
              {ungrouped.map((r) => (
                <Row key={`${r.objectType}:${r.objectRef}`} row={r} />
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

function Row({ row }: { row: EffectiveAccessRow }) {
  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-brand-hairline px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-brand-blue-dark">{row.label}</span>
        {row.role && row.role.toLowerCase() !== 'member' && (
          <span className="text-[11px] text-brand-grey-dark">{row.role}</span>
        )}
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {row.archived && (
          <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] font-medium uppercase text-brand-muted">
            archived
          </span>
        )}
        {row.sources.map((s, i) => (
          <span
            key={i}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SOURCE_TINT[s.kind] ?? 'bg-brand-hairline text-brand-muted'}`}
          >
            {s.label}
          </span>
        ))}
        {row.redundant && (
          <span
            title="On the roster and a manager of the same object — one of the two is redundant."
            className="text-brand-muted-soft"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
    </li>
  )
}
