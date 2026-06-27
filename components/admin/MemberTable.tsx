'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Avatar } from '@/components/ui/Avatar'
import { formatDateShort } from '@/lib/utils'

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

interface Filters { q: string; bracket: string; role: string; tier: string }

interface Props {
  members: MemberRow[]
  tiers: Tier[]
  total: number
  page: number
  pageSize: number
  filters: Filters
}

const BRACKETS = ['high_school', 'college', 'adult']
const ROLES = ['participant', 'mentor', 'teacher', 'donor', 'parent', 'subscriber']

const TIER_TOOLTIPS: Record<string, string> = {
  'Explorer': 'Free tier — public content, competition listings, and basic community access.',
  'Pathfinder': 'Paid tier ($59/yr) — full community access and event registration. Also awarded free for one year to event participants.',
  'Scholar': 'Award winner tier ($119/yr) — all Pathfinder benefits plus exclusive content. Awarded to competition winners.',
}

function label(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function MemberTable({ members, tiers, total, page, pageSize, filters }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState(filters.q)

  function pushFilter(updates: Partial<Filters> & { page?: number }) {
    const params = new URLSearchParams({
      q: filters.q,
      bracket: filters.bracket,
      role: filters.role,
      tier: filters.tier,
      page: String(page),
      ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, String(v)])),
    })
    // Clear empty params
    ;['q', 'bracket', 'role', 'tier'].forEach((k) => {
      if (!params.get(k)) params.delete(k)
    })
    if (params.get('page') === '1') params.delete('page')
    startTransition(() => router.push(`${pathname}?${params}`))
  }

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-brand-border p-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pushFilter({ q: search, page: 1 })}
          className="border border-brand-border rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-blue"
        />
        <select
          value={filters.bracket}
          onChange={(e) => pushFilter({ bracket: e.target.value, page: 1 })}
          className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          <option value="">All brackets</option>
          {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
        </select>
        <select
          value={filters.role}
          onChange={(e) => pushFilter({ role: e.target.value, page: 1 })}
          className="border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-brand-canvas border-b border-brand-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">Name</th>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">Email</th>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">Role</th>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">Membership</th>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">School</th>
              <th className="text-left px-4 py-3 font-medium text-brand-muted">Joined</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-hairline">
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-brand-muted-soft">
                  No members found.
                </td>
              </tr>
            )}
            {members.map((m) => {
              const activeTier = m.member_memberships?.find(
                (mm) => mm.renewal_status === 'active'
              )?.membership_tiers?.name
              const school = m.member_schools?.find((s) => s.is_current)?.schools?.name

              return (
                <tr key={m.id} className="hover:bg-brand-canvas">
                  <td className="px-4 py-3 font-medium text-brand-blue-dark">
                    <span className="flex items-center gap-2.5">
                      <Avatar id={m.id} name={`${m.first_name} ${m.last_name}`} size="sm" ring={false} />
                      <span>
                        {m.first_name} {m.last_name}
                        {m.member_code && (
                          <span className="ml-1.5 text-xs text-brand-muted-soft">{m.member_code}</span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{m.email}</td>
                  <td className="px-4 py-3 text-brand-muted">{label(m.event_role)}</td>
                  <td className="px-4 py-3">
                    {activeTier ? (
                      <span
                        className="text-xs bg-brand-blue/5 text-brand-blue px-2 py-0.5 rounded-full"
                        title={TIER_TOOLTIPS[activeTier] ?? `Active membership tier: ${activeTier}`}
                      >
                        {activeTier}
                      </span>
                    ) : (
                      <span className="text-xs text-brand-muted-soft">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{school ?? '—'}</td>
                  <td className="px-4 py-3 text-brand-muted-soft">
                    {formatDateShort(m.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/members/${m.id}`}
                      className="text-brand-blue hover:underline text-xs font-medium"
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
              onClick={() => pushFilter({ page: page - 1 })}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-brand-border rounded-lg hover:bg-brand-canvas disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => pushFilter({ page: page + 1 })}
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
