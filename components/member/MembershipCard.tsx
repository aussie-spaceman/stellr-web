'use client'

import Link from 'next/link'

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
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function MembershipCard({ membership, member }: Props) {
  if (!membership) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
          Membership
        </h2>
        <p className="text-sm text-gray-600 mb-4">No active membership found.</p>
        <Link
          href="/membership"
          className="block w-full text-center bg-brand-blue text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-800"
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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
        Membership
      </h2>

      <div className="mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xl font-bold text-gray-900">{tier.name}</span>
          <span
            className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium"
            title="Your membership is current and active."
          >
            Active
          </span>
        </div>
        {tier.grouping_title && (
          <p className="text-sm text-gray-500 mt-0.5">{tier.grouping_title}</p>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Since</dt>
          <dd className="text-gray-900">{formatDate(membership.started_at)}</dd>
        </div>
        {membership.expires_at && (
          <div className="flex justify-between">
            <dt className="text-gray-500">Expires</dt>
            <dd className={isExpiring ? 'text-amber-600 font-medium' : 'text-gray-900'}>
              {formatDate(membership.expires_at)}
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt className="text-gray-500">Annual fee</dt>
          <dd className="text-gray-900">
            {tier.is_free ? 'Free' : `$${(tier.annual_cost_cents / 100).toFixed(0)}`}
          </dd>
        </div>
        {membership.is_complimentary && (
          <div className="text-xs text-brand-blue bg-blue-50 rounded px-2 py-1 mt-2">
            Complimentary year included
          </div>
        )}
      </dl>

      {isExpiring && (
        <Link
          href="/membership"
          className="block w-full text-center mt-4 bg-brand-blue text-white rounded-lg py-2 text-sm font-medium hover:bg-blue-800"
        >
          Renew Membership
        </Link>
      )}
    </div>
  )
}
