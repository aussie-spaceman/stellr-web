// Building blocks for the admin dashboard (/admin). Server components: they
// only render what lib/admin-digest loaded.

import Link from 'next/link'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { formatDateShort } from '@/lib/utils'
import type { Metric, PersonRef } from '@/lib/admin-digest'

/** "+3 on the previous 7 days", for a stat's comparison line. */
export function deltaWords(m: Metric, days: number): string {
  const diff = m.current - m.previous
  if (diff === 0) return m.current === 0 ? 'None in either period' : `Same as the previous ${days} days`
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} on the previous ${days} days`
}

function deltaTone(m: Metric, goodWhen: 'up' | 'down' | 'neutral'): string {
  const diff = m.current - m.previous
  if (diff === 0 || goodWhen === 'neutral') return 'text-content-muted'
  return (diff > 0) === (goodWhen === 'up') ? 'text-enviro-green-text' : 'text-danger'
}

function DeltaIcon({ m }: { m: Metric }) {
  const diff = m.current - m.previous
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : Minus
  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
}

const TILE_ACCENTS = {
  primary: 'bg-primary',
  violet: 'bg-space-violet',
  green: 'bg-enviro-green',
  amber: 'bg-pathway-amber',
  danger: 'bg-danger',
  ink: 'bg-ink',
} as const

export function StatTile({
  label, metric, days, goodWhen = 'up', accent = 'primary', caption, href,
}: {
  label: string
  metric: Metric
  days: number
  goodWhen?: 'up' | 'down' | 'neutral'
  accent?: keyof typeof TILE_ACCENTS
  caption?: string
  href?: string
}) {
  const body = (
    <>
      <span className={`absolute inset-y-0 left-0 w-1 ${TILE_ACCENTS[accent]}`} aria-hidden="true" />
      <p className="font-subheading text-xs font-semibold uppercase tracking-eyebrow text-content-muted">{label}</p>
      <p className="mt-2 font-display text-ds-h2 leading-none text-ink">{metric.current.toLocaleString()}</p>
      <p className={`mt-2 flex items-center gap-1 text-xs ${deltaTone(metric, goodWhen)}`}>
        <DeltaIcon m={metric} />
        {deltaWords(metric, days)}
      </p>
      {caption && <p className="mt-1 text-xs text-content-muted">{caption}</p>}
    </>
  )
  const cls = 'app-card relative block overflow-hidden p-4'
  return href ? (
    <Link prefetch={false} href={href} className={`${cls} hover:shadow-card-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

export function Panel({
  title, count, href, hrefLabel = 'View all', children, className = '',
}: {
  title: string
  count?: number
  href?: string
  hrefLabel?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    // min-w-0: as a grid item the panel would otherwise grow to fit its
    // longest one-line detail and push the page sideways on a phone.
    <section className={`app-card min-w-0 p-5 ${className}`} aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-heading text-lg text-ink">
          {title}
          {count !== undefined && <span className="ml-2 font-subheading text-sm font-medium text-content-muted">{count}</span>}
        </h3>
        {href && (
          <Link prefetch={false} href={href} className="shrink-0 text-sm font-medium text-primary hover:underline">
            {hrefLabel}
          </Link>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** One labelled figure inside a panel, with its comparison. */
export function MetricRow({
  label, metric, days, goodWhen = 'up',
}: { label: string; metric: Metric; days: number; goodWhen?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-sm text-content-body">{label}</dt>
      <dd className="flex items-baseline gap-2 text-right">
        <span className="font-subheading text-base font-semibold text-ink">{metric.current.toLocaleString()}</span>
        <span className={`hidden text-xs sm:inline ${deltaTone(metric, goodWhen)}`}>
          {metric.current === metric.previous ? 'no change' : `${metric.current > metric.previous ? '+' : '−'}${Math.abs(metric.current - metric.previous)}`}
        </span>
      </dd>
    </div>
  )
}

/** A short list of people; the rest are behind `moreHref` when there is one. */
export function PeopleList({
  people, max = 6, moreHref, empty,
}: { people: PersonRef[]; max?: number; moreHref?: string; empty: string }) {
  if (people.length === 0) return <p className="text-sm text-content-muted">{empty}</p>
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <>
      <ul className="divide-y divide-line-light">
        {shown.map((p, i) => (
          <li key={`${p.memberId ?? p.name}-${p.at}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              {p.memberId ? (
                <Link prefetch={false} href={`/admin/members/${p.memberId}`} className="font-medium text-primary hover:underline">
                  {p.name}
                </Link>
              ) : (
                <span className="font-medium text-ink">{p.name}</span>
              )}
              {p.detail && <span className="block truncate text-xs text-content-muted">{p.detail}</span>}
            </span>
            <span className="shrink-0 text-xs text-content-muted">{formatDateShort(p.at)}</span>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-xs text-content-muted">
          {moreHref ? (
            <Link prefetch={false} href={moreHref} className="font-medium text-primary hover:underline">and {more} more</Link>
          ) : (
            `and ${more} more`
          )}
        </p>
      )}
    </>
  )
}

/** Days since an ISO instant, for "waiting 12 days". */
export function daysSince(iso: string, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000))
}
