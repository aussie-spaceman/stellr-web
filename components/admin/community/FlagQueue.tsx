'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

interface FlagRow {
  id: string
  content_type: 'post' | 'comment'
  content_id: string
  reason: string | null
  status: string
  created_at: string
  flagged_by_member: { first_name: string | null; last_name: string | null; email: string | null } | null
  resolved_by_member: { first_name: string | null; last_name: string | null } | null
}

interface Props {
  flags: FlagRow[]
}

function memberName(m: { first_name: string | null; last_name: string | null } | null): string {
  if (!m) return 'Unknown'
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
}

// Admin moderation queue — resolves or dismisses flagged content (FR-COM-07).
export function FlagQueue({ flags }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  const resolve = async (flagId: string, action: 'resolved' | 'dismissed', hideContent = false) => {
    setLoading(flagId)
    await fetch('/api/admin/community/flags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagId, action, hideContent }),
    })
    setLoading(null)
    router.refresh()
  }

  if (flags.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-brand-border py-12 text-center text-sm text-brand-muted-soft">
        No flags in this queue.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {flags.map((flag) => (
        <div key={flag.id} className="rounded-xl border border-brand-border bg-white p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-xs font-medium capitalize text-brand-muted">
                  {flag.content_type}
                </span>
                <span className="font-mono text-xs text-brand-muted-soft">{flag.content_id.slice(0, 8)}…</span>
                <Link
                  href={`/community/general/${flag.content_type === 'post' ? flag.content_id : ''}`}
                  target="_blank"
                  className="text-brand-muted-soft hover:text-brand-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
              {flag.reason && (
                <p className="text-sm text-brand-muted">
                  <span className="font-medium">Reason:</span> {flag.reason}
                </p>
              )}
              <p className="text-xs text-brand-muted-soft">
                Flagged by {memberName(flag.flagged_by_member)}
                {flag.flagged_by_member?.email && (
                  <span className="ml-1 text-brand-muted-soft">({flag.flagged_by_member.email})</span>
                )}
                {' · '}
                {new Date(flag.created_at).toLocaleDateString()}
              </p>
              {flag.resolved_by_member && (
                <p className="text-xs text-brand-muted-soft">
                  {flag.status} by {memberName(flag.resolved_by_member)}
                </p>
              )}
            </div>

            {flag.status === 'pending' && (
              <div className="flex shrink-0 flex-col gap-1.5">
                <button
                  onClick={() => resolve(flag.id, 'resolved', true)}
                  disabled={loading === flag.id}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Hide content
                </button>
                <button
                  onClick={() => resolve(flag.id, 'resolved', false)}
                  disabled={loading === flag.id}
                  className="rounded-md border border-brand-border px-3 py-1.5 text-xs font-medium text-brand-muted hover:bg-brand-canvas disabled:opacity-50"
                >
                  Resolve
                </button>
                <button
                  onClick={() => resolve(flag.id, 'dismissed')}
                  disabled={loading === flag.id}
                  className="rounded-md px-3 py-1.5 text-xs text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
