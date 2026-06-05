'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useState, useTransition } from 'react'
import Link from 'next/link'

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
const ROLES = ['school_student', 'mentor', 'teacher', 'donor', 'parent', 'subscriber']

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
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-3">
        <input
          type="search"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pushFilter({ q: search, page: 1 })}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <select
          value={filters.bracket}
          onChange={(e) => pushFilter({ bracket: e.target.value, page: 1 })}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All brackets</option>
          {BRACKETS.map((b) => <option key={b} value={b}>{label(b)}</option>)}
        </select>
        <select
          value={filters.role}
          onChange={(e) => pushFilter({ role: e.target.value, page: 1 })}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Membership</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">School</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Joined</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {members.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
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
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {m.first_name} {m.last_name}
                    {m.member_code && (
                      <span className="ml-1.5 text-xs text-gray-400">{m.member_code}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.email}</td>
                  <td className="px-4 py-3 text-gray-600">{label(m.event_role)}</td>
                  <td className="px-4 py-3">
                    {activeTier ? (
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                        {activeTier}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{school ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {new Date(m.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/members/${m.id}`}
                      className="text-indigo-600 hover:underline text-xs font-medium"
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
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => pushFilter({ page: page - 1 })}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => pushFilter({ page: page + 1 })}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
