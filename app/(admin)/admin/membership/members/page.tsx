import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import { MembershipNav } from '../MembershipNav'

export const metadata = { title: 'Admin — Membership Members' }
export const dynamic = 'force-dynamic'

const SOURCE_LABEL: Record<string, string> = {
  stripe: 'Paid (Stripe)',
  rule: 'Auto rule',
  manual: 'Manual',
  system: 'System',
}
const SOURCE_BADGE: Record<string, string> = {
  stripe: 'bg-brand-blue/10 text-brand-blue',
  rule: 'bg-amber-100 text-amber-800',
  manual: 'bg-brand-hairline text-brand-muted',
  system: 'bg-purple-100 text-purple-800',
}

type Joined = {
  id: string
  started_at: string
  expires_at: string | null
  source: string | null
  members: { id: string; first_name: string | null; last_name: string | null } | { id: string; first_name: string | null; last_name: string | null }[] | null
  membership_tiers: { name: string } | { name: string }[] | null
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v)

// Membership Studio · Members tab. Live tier distribution plus the most recent
// grants with provenance (how each membership was assigned) and a "view as" link
// to verify the member's resulting access.
export default async function MembershipMembersPage() {
  const db = supabaseServer()

  const [{ data: tiers }, { data: memberships }, { data: recent }] = await Promise.all([
    db.from('membership_tiers').select('id, name, is_free').order('sort_order'),
    db.from('member_memberships').select('tier_id').eq('renewal_status', 'active'),
    db.from('member_memberships')
      .select('id, started_at, expires_at, source, members(id, first_name, last_name), membership_tiers(name)')
      .eq('renewal_status', 'active')
      .order('started_at', { ascending: false })
      .limit(40),
  ])

  const counts = new Map<string, number>()
  for (const m of memberships ?? []) if (m.tier_id) counts.set(m.tier_id, (counts.get(m.tier_id) ?? 0) + 1)

  return (
    <div>
      <h1 className="font-heading uppercase text-title text-brand-blue-dark">Membership Studio</h1>
      <p className="mt-0.5 mb-4 text-sm text-brand-muted-soft">Who is on which tier, and how they got there.</p>
      <MembershipNav />

      <h2 className="text-sm font-medium text-brand-muted mb-2">Active members by tier</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-8">
        {(tiers ?? []).map((t) => (
          <div key={t.id} className="bg-brand-canvas rounded-md p-3">
            <div className="text-xs text-brand-muted-soft">{t.name}</div>
            <div className="text-xl font-semibold text-brand-blue-dark">{counts.get(t.id) ?? 0}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-medium text-brand-muted mb-2">Recent grants</h2>
      <div className="bg-white border border-brand-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-brand-canvas text-brand-muted-soft text-xs">
            <tr>
              <th className="text-left font-medium px-4 py-2">Member</th>
              <th className="text-left font-medium px-4 py-2">Tier</th>
              <th className="text-left font-medium px-4 py-2">Source</th>
              <th className="text-left font-medium px-4 py-2">Started</th>
              <th className="text-left font-medium px-4 py-2">Expires</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(recent as Joined[] | null ?? []).map((r) => {
              const member = one(r.members)
              const tier = one(r.membership_tiers)
              const src = r.source ?? 'manual'
              return (
                <tr key={r.id} className="border-t border-brand-hairline">
                  <td className="px-4 py-2 text-brand-blue-dark">{member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || '—' : '—'}</td>
                  <td className="px-4 py-2 text-brand-muted">{tier?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={'text-[11px] px-2 py-0.5 rounded-md ' + (SOURCE_BADGE[src] ?? SOURCE_BADGE.manual)}>
                      {SOURCE_LABEL[src] ?? src}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-brand-muted-soft">{r.started_at}</td>
                  <td className="px-4 py-2 text-brand-muted-soft">{r.expires_at ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    {member && (
                      <Link href={`/admin/members/${member.id}/view-as`} className="text-xs text-brand-blue hover:underline">
                        View as
                      </Link>
                    )}
                  </td>
                </tr>
              )
            })}
            {(!recent || recent.length === 0) && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-brand-muted-soft">No active grants yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
