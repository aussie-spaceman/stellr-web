'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Link2, PlayCircle, Lock } from 'lucide-react'

export interface AttachedItem {
  resourceId: string
  title: string
  fileType: string | null
  /** Per-attachment membership floor: null/0 = everyone on roster, >0 = paid. */
  minMembership?: number | null
}

// Attached resources for a managed container, with a per-attachment access floor
// + detach. Detach removes only THIS attachment — the binary and its other
// attachments survive (handover §7).
export function AttachedResourceList({ containerId, items }: { containerId: string; items: AttachedItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const post = async (binaryId: string, body: Record<string, unknown>) => {
    setBusy(binaryId)
    const res = await fetch('/api/community/resources/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containerId, binaryId, ...body }),
    })
    setBusy(null)
    if (res.ok) router.refresh()
  }

  if (items.length === 0) {
    return <p className="text-sm text-content-muted">No resources attached yet.</p>
  }

  return (
    <ul className="divide-y divide-line-light">
      {items.map((r) => {
        const ft = (r.fileType ?? '').toLowerCase()
        const Icon = ft === 'link' || ft === 'url' ? Link2 : ft.startsWith('video/') ? PlayCircle : FileText
        return (
          <li key={r.resourceId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex items-center gap-2 font-medium text-ink">
              <Icon className="h-4 w-4 text-primary" /> {r.title}
            </span>
            <div className="flex items-center gap-3">
              <ResourceAccessSelect
                value={(r.minMembership ?? 0) > 0 ? 'paid' : 'all'}
                disabled={busy === r.resourceId}
                onChange={(v) => post(r.resourceId, { action: 'setAccess', minMembership: v === 'paid' ? 1 : null })}
              />
              <button
                onClick={() => post(r.resourceId, { action: 'detach' })}
                disabled={busy === r.resourceId}
                className="text-[13px] font-medium text-danger hover:underline disabled:opacity-50"
              >
                {busy === r.resourceId ? 'Saving…' : 'Remove'}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** Who on the roster can open this attachment (the re-homed green-circle). */
export function ResourceAccessSelect({
  value,
  disabled,
  onChange,
}: {
  value: 'all' | 'paid'
  disabled?: boolean
  onChange: (v: 'all' | 'paid') => void
}) {
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-content-secondary">
      <Lock className="h-3.5 w-3.5 text-content-faint" />
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as 'all' | 'paid')}
        className="rounded-[7px] border border-line px-2 py-1 text-[12.5px] text-content focus:border-primary focus:outline-none disabled:opacity-50"
      >
        <option value="all">Everyone on roster</option>
        <option value="paid">Paid members only</option>
      </select>
    </label>
  )
}
