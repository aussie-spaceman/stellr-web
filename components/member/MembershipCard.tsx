'use client'

import Link from 'next/link'
import { formatDateShort } from '@/lib/utils'

interface Tier {
  name: string
  grouping_title: string | null
  annual_cost_cents: number
  is_free: boolean
}

interface Membership {
  tier_id: string
  started_at: string
  expires_at: string | null
  renewal_status: string
  is_complimentary: boolean
  membership_tiers: Tier
}

interface Member {
  event_role: string
}

interface Props {
  membership: Membership | null | undefined
  member: Member
  /** The member's 7-digit Membership ID (from participants.membership_id). */
  membershipId?: string | null
}

function MemberIdRow({ membershipId }: { membershipId?: string | null }) {
  if (!membershipId) return null
  return (
    <div className="flex items-center justify-between text-sm mb-4 pb-4 border-b border-brand-hairline">
      <span className="text-brand-muted-soft">Member ID</span>
      <span className="font-mono font-medium text-brand-blue-dark">{membershipId}</span>
    </div>
  )
}

const formatDate = formatDateShort

export function MembershipCard({ membership, member, membershipId }: Props) {
  if (!membership) {
    return (
      <div className="bg-white rounded-xl border border-brand-border p-6">
        <h2 className="text-sm font-semibold text-brand-muted-soft uppercase tracking-wide mb-4">
          Membership
        </h2>
        <MemberIdRow membershipId={membershipId} />
        <p className="text-sm text-brand-muted mb-4">No active membership found.</p>
        <Link
          href="/membership"
          className="block w-full text-center bg-brand-blue text-white rounded-lg py-2 text-sm font-medium hover:bg-brand-blue-dark"
        >
          View Plans
        </Link>
      </div>
    )
  }

  const tier = membership.membership_tiers
  const isExpiring = membership.expires_at &&
    new Date(membership.expires_at) < new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  return (
    <div className="overflow-hidden rounded-card border border-brand-border bg-white shadow-card">
      {/* Navy / gold header */}
      <div className="bg-brand-blue-dark px-6 py-4">
        <p className="eyebrow text-white/55">Membership</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-heading text-xl uppercase text-brand-orange">{tier.name}</span>
          <span
            className="rounded-full bg-white/15 px-2 py-1 text-xs font-subheading font-semibold text-white"
            title="Your membership is current and active."
          >
            Active
          </span>
        </div>
        {tier.grouping_title && (
          <p className="mt-0.5 text-sm text-white/60">{tier.grouping_title}</p>
        )}
      </div>

      <div className="p-6">
      <MemberIdRow membershipId={membershipId} />

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-brand-muted-soft">Since</dt>
          <dd className="text-brand-blue-dark">{formatDate(membership.started_at)}</dd>
        </div>
        {membership.expires_at && (
          <div className="flex justify-between">
            <dt className="text-brand-muted-soft">Expires</dt>
            <dd className={isExpiring ? 'text-brand-gold-ink font-medium' : 'text-brand-blue-dark'}>
              {formatDate(membership.expires_at)}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-brand-muted-soft">Annual fee</dt>
          <dd className="text-brand-blue-dark">
            {tier.is_free ? 'Free' : `$${(tier.annual_cost_cents / 100).toFixed(0)}`}
          </dd>
        </div>
        {membership.is_complimentary && (
          <div className="text-xs text-brand-blue bg-brand-blue/5 rounded px-2 py-1 mt-2">
            Complimentary year included
          </div>
        )}
      </dl>

      {isExpiring && (
        <Link
          href="/membership"
          className="block w-full text-center mt-4 bg-brand-blue text-white rounded-lg py-2 text-sm font-medium hover:bg-brand-blue-dark"
        >
          Renew Membership
        </Link>
      )}
      </div>
    </div>
  )
}
