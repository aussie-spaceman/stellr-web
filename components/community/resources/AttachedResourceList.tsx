'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Link2, PlayCircle } from 'lucide-react'

export interface AttachedItem {
  resourceId: string
  title: string
  fileType: string | null
}

// Attached resources for a managed container, with detach. Detach removes only
// THIS attachment — the binary and its other attachments survive (handover §7).
export function AttachedResourceList({ containerId, items }: { containerId: string; items: AttachedItem[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const detach = async (binaryId: string) => {
    setBusy(binaryId)
    const res = await fetch('/api/community/resources/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ containerId, action: 'detach', binaryId }),
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
          <li key={r.resourceId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex items-center gap-2 font-medium text-ink">
              <Icon className="h-4 w-4 text-primary" /> {r.title}
            </span>
            <button
              onClick={() => detach(r.resourceId)}
              disabled={busy === r.resourceId}
              className="text-[13px] font-medium text-danger hover:underline disabled:opacity-50"
            >
              {busy === r.resourceId ? 'Removing…' : 'Remove'}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
