'use client'

import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export interface PricingTier {
  id: string
  name: string
  annualCost: number
  isFree: boolean
  hasMonthly: boolean
  description: string
  benefits: string[]
  highlight?: boolean
  badge?: string
}

interface TierCardProps {
  tier: PricingTier
  billingInterval: 'monthly' | 'annual'
  isLoggedIn: boolean
  signInUrl: string
}

function monthlyEquivalent(annualCost: number) {
  return (annualCost / 12).toFixed(2)
}

function TierCard({ tier, billingInterval, isLoggedIn, signInUrl }: TierCardProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const showMonthly = billingInterval === 'monthly' && tier.hasMonthly
  const displayPrice = tier.isFree
    ? 'Free'
    : showMonthly
    ? `$${monthlyEquivalent(tier.annualCost)}/mo`
    : `$${tier.annualCost}/yr`

  async function handleCheckout() {
    if (!isLoggedIn) {
      router.push(signInUrl)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/stripe/membership-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId: tier.id, billingInterval }),
      })
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('Checkout error:', data.error)
        setLoading(false)
      }
    } catch (err) {
      console.error('Checkout failed:', err)
      setLoading(false)
    }
  }

  return (
    <div className={`rounded-xl border p-6 flex flex-col ${tier.highlight ? 'border-brand-blue shadow-lg ring-2 ring-brand-blue' : 'border-line'}`}>
      {tier.badge && (
        <span className="inline-block text-xs font-bold uppercase tracking-wider text-brand-blue mb-3">
          {tier.badge}
        </span>
      )}
      <h3 className="text-xl font-bold text-brand-blue-dark">{tier.name}</h3>
      <p className="text-2xl font-bold text-brand-blue mt-1">{displayPrice}</p>
      {!tier.isFree && showMonthly && (
        <p className="text-xs text-content-faint mt-0.5">Billed ${tier.annualCost} annually</p>
      )}
      <p className="text-sm text-brand-grey-mid mt-1 mb-4">{tier.description}</p>
      <ul className="space-y-2 flex-1">
        {tier.benefits.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-brand-grey-dark">
            <CheckCircle size={16} className="text-brand-blue mt-0.5 shrink-0" />
            {b}
          </li>
        ))}
      </ul>
      {!tier.isFree && (
        <button
          onClick={handleCheckout}
          disabled={loading}
          className={`mt-6 btn-primary w-full justify-center text-sm ${!tier.highlight ? 'bg-brand-blue-dark hover:bg-ink' : ''} disabled:opacity-60 disabled:cursor-not-allowed`}
        >
          {loading ? 'Redirecting…' : `Get ${tier.name}`}
        </button>
      )}
    </div>
  )
}

interface PricingSectionProps {
  tiers: PricingTier[]
  groupLabel: string
  groupDescription: string
  isLoggedIn: boolean
  signInUrl: string
  bgGray?: boolean
}

export function PricingSection({
  tiers,
  groupLabel,
  groupDescription,
  isLoggedIn,
  signInUrl,
  bgGray,
}: PricingSectionProps) {
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('annual')
  const hasMonthlyOption = tiers.some((t) => t.hasMonthly)

  return (
    <section className={`section-padding${bgGray ? ' bg-brand-grey-light' : ''}`}>
      <div className="container-max">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-8 gap-4">
          <div>
            <h2 className="text-2xl font-bold text-brand-blue-dark mb-1">{groupLabel}</h2>
            <p className="text-brand-grey-dark">{groupDescription}</p>
          </div>
          {hasMonthlyOption && (
            <div className="flex items-center gap-1 bg-surface rounded-lg p-1 self-start sm:self-auto">
              <button
                onClick={() => setBillingInterval('annual')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  billingInterval === 'annual'
                    ? 'bg-white text-brand-blue-dark shadow-sm'
                    : 'text-content-muted hover:text-content-body'
                }`}
              >
                Annual
              </button>
              <button
                onClick={() => setBillingInterval('monthly')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  billingInterval === 'monthly'
                    ? 'bg-white text-brand-blue-dark shadow-sm'
                    : 'text-content-muted hover:text-content-body'
                }`}
              >
                Monthly
              </button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <TierCard
              key={tier.id}
              tier={tier}
              billingInterval={billingInterval}
              isLoggedIn={isLoggedIn}
              signInUrl={signInUrl}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
