'use client'

import { useState } from 'react'
import { formatDateShort, formatDateTime } from '@/lib/utils'
import {
  Award, User, ShieldCheck, Calendar, CreditCard,
  FileText, Users, GraduationCap, Activity as ActivityIcon,
  type LucideIcon,
} from 'lucide-react'

export interface ActivityItem {
  id: string
  actor_type: string
  actor_label: string | null
  category: string
  action: string
  summary: string
  metadata: Record<string, unknown> | null
  created_at: string
}

interface Props {
  /** First page, rendered server-side. */
  items: ActivityItem[]
  /** GET endpoint for paging — supports ?before=<created_at> & ?limit. */
  fetchUrl: string
  pageSize?: number
}

const CATEGORY: Record<string, { label: string; icon: LucideIcon; cls: string }> = {
  membership: { label: 'Membership', icon: Award, cls: 'bg-brand-blue/5 text-brand-blue' },
  profile: { label: 'Profile', icon: User, cls: 'bg-sky-50 text-sky-600' },
  account: { label: 'Account', icon: ShieldCheck, cls: 'bg-brand-hairline text-brand-muted' },
  event: { label: 'Event', icon: Calendar, cls: 'bg-brand-orange/5 text-brand-gold-ink' },
  billing: { label: 'Billing', icon: CreditCard, cls: 'bg-emerald-50 text-emerald-600' },
  docusign: { label: 'Consent form', icon: FileText, cls: 'bg-purple-50 text-purple-600' },
  community: { label: 'Community', icon: Users, cls: 'bg-rose-50 text-rose-600' },
  school: { label: 'School', icon: GraduationCap, cls: 'bg-teal-50 text-teal-600' },
}

const ACTOR_LABEL: Record<string, string> = {
  admin: 'Stellr admin',
  member: 'Member',
  system: 'System',
  stripe: 'Payment',
  docusign: 'DocuSign',
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDateShort(iso)
}

export function ActivityTimeline({ items: initial, fetchUrl, pageSize = 30 }: Props) {
  const [items, setItems] = useState<ActivityItem[]>(initial)
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(initial.length < pageSize)

  async function loadMore() {
    if (loading || items.length === 0) return
    setLoading(true)
    const before = items[items.length - 1].created_at
    const sep = fetchUrl.includes('?') ? '&' : '?'
    const res = await fetch(`${fetchUrl}${sep}before=${encodeURIComponent(before)}&limit=${pageSize}`)
    setLoading(false)
    if (!res.ok) return
    const { items: next } = (await res.json()) as { items: ActivityItem[] }
    setItems((cur) => [...cur, ...next])
    if (!next || next.length < pageSize) setExhausted(true)
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <ActivityIcon className="h-6 w-6 text-brand-muted-soft" />
        <p className="mt-2 text-sm text-brand-muted-soft">No activity recorded yet.</p>
      </div>
    )
  }

  return (
    <div>
      <ul className="space-y-0">
        {items.map((item, i) => {
          const cat = CATEGORY[item.category] ?? {
            label: item.category, icon: ActivityIcon, cls: 'bg-brand-hairline text-brand-muted',
          }
          const Icon = cat.icon
          const actor = item.actor_label || ACTOR_LABEL[item.actor_type] || 'System'
          const last = i === items.length - 1
          return (
            <li key={item.id} className="relative flex gap-3 pb-5">
              {!last && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-brand-border" aria-hidden />}
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cat.cls}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-sm text-brand-blue-dark">{item.summary}</p>
                <p className="mt-0.5 text-xs text-brand-muted-soft">
                  <span className="font-medium text-brand-muted-soft">{cat.label}</span>
                  {' · '}
                  {actor}
                  {' · '}
                  <time dateTime={item.created_at} title={formatDateTime(item.created_at)}>
                    {relativeTime(item.created_at)}
                  </time>
                </p>
              </div>
            </li>
          )
        })}
      </ul>

      {!exhausted && (
        <button
          onClick={loadMore}
          disabled={loading}
          className="mt-1 text-sm font-medium text-brand-blue hover:text-brand-blue disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
