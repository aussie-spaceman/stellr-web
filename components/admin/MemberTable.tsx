'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { formatDateShort } from '@/lib/utils'
import {
  MEMBER_BRACKETS,
  MEMBER_ROLES,
  NO_TIER,
  activeMemberFilterCount,
  memberFilterParams,
  type MemberFilters,
  type MemberSort,
} from '@/lib/admin-member-filters'

export interface MemberRow {
  id: string
  member_code: string | null
  first_name: string
  last_name: string
  email: string
  phone: string | null
  age_bracket: string
  event_role: string
  grade: string | null
  is_active: boolean
  created_at: string
  member_memberships: Array<{
    renewal_status: string
    membership_tiers: { name: string }
  }>
  member_schools: Array<{
    is_current: boolean
    schools: { name: string }
  }>
}

interface Tier { id: string; name: string }

interface Props {
  members: MemberRow[]
  tiers: Tier[]
  /** School names, offered as suggestions in the School filter. */
  schools?: string[]
  total: number
  page: number
  pageSize: number
  filters: MemberFilters
}

const TIER_TOOLTIPS: Record<string, string> = {
  'Explorer': 'Free tier — public content, competition listings, and basic community access.',
  'Pathfinder': 'Paid tier ($59/yr) — full community access and event registration. Also awarded free for one year to event participants.',
  'Scholar': 'Award winner tier ($119/yr) — all Pathfinder benefits plus exclusive content. Awarded to competition winners.',
}

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// On a phone the table scrolls sideways inside its card instead of being
// clipped, and the name column stays put: it is the link to the member, so a
// row can always be opened without scrolling to the end. The table is
// border-separate because a sticky cell in a collapsed table leaves its
// borders behind when it moves; row lines therefore live on the cells.
const TH = 'whitespace-nowrap border-b border-line px-4 py-3 text-left font-medium text-content-body'
const TD = 'border-b border-line-light px-4 py-3 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'
// The filter row sits under the headers and scrolls with its columns.
const FILTER_TD = 'border-b border-line px-2 py-2 align-top font-normal'
const CONTROL = 'border border-line-strong rounded-lg px-3 py-2 text-input mouse:text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-blue'
// Tighter than CONTROL so the filter row doesn't widen the table past the screen.
const FILTER_CONTROL = 'w-full min-w-24 rounded-lg border border-line-strong bg-white px-2 py-1.5 text-input mouse:text-sm focus:outline-hidden focus:ring-2 focus:ring-brand-blue'

// Newest first is the useful default for dates; A–Z for everything else.
const FIRST_DIR: Record<MemberSort, 'asc' | 'desc'> = { name: 'asc', email: 'asc', role: 'asc', joined: 'desc' }

/**
 * A text filter that applies on Enter or when focus leaves it, rather than on
 * every keystroke: each change is a server round-trip.
 */
function FilterText({
  value,
  onCommit,
  ...input
}: { value: string; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState(value)
  // Follow the URL when it changes underneath us (Clear filters, back button).
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim())
  }
  return (
    <input
      {...input}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      onBlur={commit}
    />
  )
}

function SortHeader({
  sort, children, filters, onSort, className = '',
}: { sort: MemberSort; children: React.ReactNode; filters: MemberFilters; onSort: (s: MemberSort) => void; className?: string }) {
  const active = filters.sort === sort
  const Icon = !active ? ArrowUpDown : filters.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${TH} ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className="inline-flex items-center gap-1.5 rounded hover:text-ink focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"
      >
        {children}
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-primary' : 'text-content-faint'}`} aria-hidden="true" />
      </button>
    </th>
  )
}

export function MemberTable({ members, tiers, schools = [], total, page, pageSize, filters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()

  // Any filter change goes back to page 1; paging keeps the filters.
  function go(next: Partial<MemberFilters>, nextPage = 1) {
    const params = memberFilterParams({ ...filters, ...next }, nextPage > 1 ? { page: String(nextPage) } : {})
    const qs = params.toString()
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname))
  }

  function sortBy(sort: MemberSort) {
    const dir = filters.sort === sort ? (filters.dir === 'asc' ? 'desc' : 'asc') : FIRST_DIR[sort]
    go({ sort, dir })
  }

  const filterCount = activeMemberFilterCount(filters)
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      {/* Search across name and email, plus the one filter with no column. */}
      <div className="bg-white rounded-xl border border-brand-border p-4 flex flex-wrap items-center gap-3">
        <FilterText
          type="search"
          aria-label="Search name or email"
          placeholder="Search name or email…"
          value={filters.q}
          onCommit={(q) => go({ q })}
          className={`${CONTROL} w-64`}
        />
        <select
          aria-label="Age bracket"
          value={filters.bracket}
          onChange={(e) => go({ bracket: e.target.value })}
          className={CONTROL}
        >
          <option value="">All brackets</option>
          {MEMBER_BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
        </select>
        <p className="text-xs text-content-muted">Filter or sort any column in the table below.</p>
        {filterCount > 0 && (
          <button
            type="button"
            onClick={() => go({ q: '', bracket: '', role: '', tier: '', name: '', email: '', school: '', joinedFrom: '', joinedTo: '' })}
            className="ml-auto inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-primary hover:bg-surface"
          >
            Clear {filterCount} filter{filterCount === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Table */}
      <div
        role="region"
        aria-label="Members"
        aria-busy={pending}
        tabIndex={0}
        className={`relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${pending ? 'opacity-70' : ''}`}
      >
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead className="bg-surface">
            <tr>
              <SortHeader sort="name" filters={filters} onSort={sortBy} className={`${STICKY} bg-surface`}>Name</SortHeader>
              <SortHeader sort="email" filters={filters} onSort={sortBy}>Email</SortHeader>
              <SortHeader sort="role" filters={filters} onSort={sortBy}>Role</SortHeader>
              <th scope="col" className={TH}>Membership</th>
              <th scope="col" className={TH}>School</th>
              <SortHeader sort="joined" filters={filters} onSort={sortBy}>Joined</SortHeader>
              <th scope="col" className={TH}>
                <span className="sr-only">Open</span>
              </th>
            </tr>
            <tr>
              <td className={`${FILTER_TD} ${STICKY} bg-surface`}>
                <FilterText
                  type="search"
                  aria-label="Filter by name"
                  placeholder="Any name"
                  value={filters.name}
                  onCommit={(name) => go({ name })}
                  className={FILTER_CONTROL}
                />
              </td>
              <td className={FILTER_TD}>
                <FilterText
                  type="search"
                  aria-label="Filter by email"
                  placeholder="Any email"
                  value={filters.email}
                  onCommit={(email) => go({ email })}
                  className={FILTER_CONTROL}
                />
              </td>
              <td className={FILTER_TD}>
                <select
                  aria-label="Filter by role"
                  value={filters.role}
                  onChange={(e) => go({ role: e.target.value })}
                  className={FILTER_CONTROL}
                >
                  <option value="">Any role</option>
                  {MEMBER_ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </select>
              </td>
              <td className={FILTER_TD}>
                <select
                  aria-label="Filter by membership"
                  value={filters.tier}
                  onChange={(e) => go({ tier: e.target.value })}
                  className={`${FILTER_CONTROL} min-w-36`}
                >
                  <option value="">Any membership</option>
                  <option value={NO_TIER}>No active membership</option>
                  {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td>
              <td className={FILTER_TD}>
                <FilterText
                  type="search"
                  aria-label="Filter by current school"
                  placeholder="Any school"
                  list="member-filter-schools"
                  value={filters.school}
                  onCommit={(school) => go({ school })}
                  className={FILTER_CONTROL}
                />
                <datalist id="member-filter-schools">
                  {schools.map((s) => <option key={s} value={s} />)}
                </datalist>
              </td>
              <td className={FILTER_TD}>
                <div className="flex flex-col gap-1.5">
                  <input
                    type="date"
                    aria-label="Joined on or after"
                    title="Joined on or after"
                    value={filters.joinedFrom}
                    max={filters.joinedTo || undefined}
                    onChange={(e) => go({ joinedFrom: e.target.value })}
                    className={FILTER_CONTROL}
                  />
                  <input
                    type="date"
                    aria-label="Joined on or before"
                    title="Joined on or before"
                    value={filters.joinedTo}
                    min={filters.joinedFrom || undefined}
                    onChange={(e) => go({ joinedTo: e.target.value })}
                    className={FILTER_CONTROL}
                  />
                </div>
              </td>
              <td className={FILTER_TD} />
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-content-muted">
                  {filterCount > 0 ? 'No members match these filters.' : 'No members found.'}
                </td>
              </tr>
            )}
            {members.map((m) => {
              const activeTier = m.member_memberships?.find(
                (mm) => mm.renewal_status === 'active'
              )?.membership_tiers?.name
              const school = m.member_schools?.find((s) => s.is_current)?.schools?.name

              return (
                <tr key={m.id} className="group hover:bg-surface">
                  <td className={`${TD} ${STICKY} bg-white group-hover:bg-surface`}>
                    <Link
                      prefetch={false}
                      href={`/admin/members/${m.id}`}
                      className="flex items-center gap-2.5 font-medium text-primary hover:underline"
                    >
                      {/* aria-hidden: the avatar is labelled with the name, which
                          the link would otherwise announce twice. */}
                      <span aria-hidden className="flex shrink-0">
                        <Avatar id={m.id} name={`${m.first_name} ${m.last_name}`} size="sm" ring={false} />
                      </span>
                      <span>
                        {m.first_name} {m.last_name}
                        {/* The space keeps the code a separate word in the link's name. */}
                        {m.member_code && (
                          <>
                            {' '}
                            <span className="ml-0.5 text-xs font-normal text-content-muted">{m.member_code}</span>
                          </>
                        )}
                      </span>
                    </Link>
                  </td>
                  {/* A long address may break after the @, and only once the
                      table runs out of room. */}
                  <td className={`${TD} text-content-body`}>
                    {m.email.includes('@') ? (
                      <>
                        {m.email.slice(0, m.email.lastIndexOf('@') + 1)}
                        <wbr />
                        {m.email.slice(m.email.lastIndexOf('@') + 1)}
                      </>
                    ) : (
                      m.email
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-content-body`}>{label(m.event_role)}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {activeTier ? (
                      <span
                        className="text-xs bg-primary/5 text-primary px-2 py-0.5 rounded-full"
                        title={TIER_TOOLTIPS[activeTier] ?? `Active membership tier: ${activeTier}`}
                      >
                        {activeTier}
                      </span>
                    ) : (
                      <span className="text-xs text-content-muted">—</span>
                    )}
                  </td>
                  <td className={`${TD} min-w-40 text-content-body`}>{school ?? '—'}</td>
                  <td className={`${TD} whitespace-nowrap text-content-muted`}>
                    {formatDateShort(m.created_at)}
                  </td>
                  <td className={TD}>
                    <Link
                      prefetch={false}
                      href={`/admin/members/${m.id}`}
                      className="text-primary hover:underline text-xs font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-brand-muted">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => go({}, page - 1)}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-brand-border rounded-lg hover:bg-brand-canvas disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => go({}, page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-brand-border rounded-lg hover:bg-brand-canvas disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
