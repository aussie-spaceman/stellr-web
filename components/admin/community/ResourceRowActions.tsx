'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from '@/components/ui/Toast'

// Per-resource permission control (the "green circle") + individual delete.
// The circle toggles download access between "All members" (green, min_tier_rank 0)
// and "Paid only" (amber, min_tier_rank 1), overriding the parent space default.
export function ResourceRowActions({
  resourceId,
  minTierRank,
}: {
  resourceId: string
  minTierRank: number
}) {
  const router = useRouter()
  const [rank, setRank] = useState(minTierRank)
  const [busy, setBusy] = useState(false)

  const paid = rank > 0

  const toggleAccess = async () => {
    const next = paid ? 0 : 1
    setBusy(true)
    const res = await fetch('/api/admin/community/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: resourceId, minTierRank: next }),
    })
    setBusy(false)
    if (!res.ok) return toast('Could not update access')
    setRank(next)
    toast(next > 0 ? 'Now paid-tier only' : 'Now visible to all members')
  }

  const remove = async () => {
    if (!confirm('Delete this resource? Its file is removed permanently.')) return
    setBusy(true)
    const res = await fetch(`/api/admin/community/resources?id=${resourceId}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) return toast('Could not delete resource')
    toast('Resource deleted')
    router.refresh()
  }

  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={toggleAccess}
        disabled={busy}
        title={paid ? 'Paid tiers only — click to allow all members' : 'All members — click to restrict to paid tiers'}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted disabled:opacity-50"
      >
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: paid ? '#E0922F' : '#1FA97A' }}
          aria-hidden
        />
        {paid ? 'Paid only' : 'All members'}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label="Delete resource"
        className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}
