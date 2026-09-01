import type { ReactNode } from 'react'
import Link from 'next/link'
import { Global } from '@stellr/icons'
import { STELLR_EIN } from '@/lib/org'

/**
 * The standing "where this money goes" disclosure.
 *
 * Google Ad Grants requires a nonprofit site to show how its limited commercial
 * activity supports the mission, and to say what the money is used for — at the
 * point of price, not buried in Terms. This renders that statement wherever the
 * site asks anyone for money, so the answer is never more than one panel away.
 *
 * Keep the wording here rather than at each call site: a single source means the
 * claims stay consistent across nine surfaces, and there is one place to edit if
 * the funding model changes.
 */

export type FundingVariant = 'general' | 'store' | 'donate'

const COPY: Record<FundingVariant, { heading: string; body: ReactNode }> = {
  general: {
    heading: 'Where this money goes',
    body: (
      <>
        Stellr Education is a registered 501(c)(3) nonprofit (EIN {STELLR_EIN}). Participation fees
        and membership subscriptions cover the direct cost of running our programs — venues,
        materials, mentor travel and safeguarding — and any surplus is reinvested into scholarships
        that let students take part regardless of what their family can pay. No fee is ever a
        barrier: <Link href="/scholarship" className="font-medium text-primary-deep underline underline-offset-2 hover:no-underline">apply for a scholarship</Link>{' '}
        and we cover the full cost.
      </>
    ),
  },
  store: {
    heading: 'Every purchase funds our programs',
    body: (
      <>
        Stellr Education is a registered 501(c)(3) nonprofit (EIN {STELLR_EIN}). All proceeds from
        merchandise go directly to running student competitions and funding scholarship places for
        students who could not otherwise attend. Nothing here is sold for profit.
      </>
    ),
  },
  donate: {
    heading: 'How your donation is used',
    body: (
      <>
        Stellr Education is a registered 501(c)(3) nonprofit (EIN {STELLR_EIN}). Donations fund
        scholarships, event delivery, and the resources that let students take part regardless of
        what their family can pay. Contributions are tax-deductible to the extent allowed by law.
      </>
    ),
  },
}

interface MissionFundingNoteProps {
  variant?: FundingVariant
  /** Drops the heading and icon for tight spots such as the cart summary. */
  compact?: boolean
  className?: string
}

export function MissionFundingNote({
  variant = 'general',
  compact = false,
  className = '',
}: MissionFundingNoteProps) {
  const { heading, body } = COPY[variant]

  if (compact) {
    return (
      <p className={`text-sm leading-relaxed text-content-secondary ${className}`}>
        {body}{' '}
        <Link
          href="/impact#funding"
          className="font-medium text-primary-deep underline underline-offset-2 hover:no-underline"
        >
          How we&rsquo;re funded
        </Link>
      </p>
    )
  }

  return (
    <aside
      className={`rounded-panel border border-line bg-surface p-6 sm:p-7 ${className}`}
      aria-label={heading}
    >
      <div className="flex items-start gap-4">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary sm:flex">
          <Global size={20} />
        </span>
        <div>
          <h3 className="font-heading text-base font-bold text-ink">{heading}</h3>
          <p className="mt-2 text-sm leading-relaxed text-content-secondary">{body}</p>
          <Link
            href="/impact#funding"
            className="mt-3 inline-block text-sm font-medium text-primary-deep underline underline-offset-2 hover:no-underline"
          >
            How we&rsquo;re funded
          </Link>
        </div>
      </div>
    </aside>
  )
}
