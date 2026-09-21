'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@stellr/web-ui'

// "Sync now" for the compliance audit page: re-polls every open background
// check against the provider (POST /api/admin/compliance/sync). This is the
// recovery path when a webhook was missed, and the only refresh path on the
// dev deployment where the daily cron declines to run.
export function ComplianceSyncButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function sync() {
    setBusy(true)
    setNote(null)
    const res = await fetch('/api/admin/compliance/sync', { method: 'POST' })
    const d = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) {
      setNote(d?.error ?? 'Sync failed.')
      return
    }
    const errors = d?.errors?.length ? `, ${d.errors.length} could not be checked` : ''
    setNote(
      d?.scanned === 0
        ? 'No open checks to sync.'
        : `Checked ${d.scanned} open — ${d.updated} updated, ${d.unchanged} unchanged${errors}.`,
    )
    if (d?.updated) router.refresh()
  }

  return (
    <div className="flex items-center gap-3">
      <Button variant="softBlue" className="text-sm !py-2" onClick={sync} disabled={busy}>
        {busy ? 'Syncing…' : 'Sync with Checkr'}
      </Button>
      {note && <span className="text-xs text-brand-muted-soft">{note}</span>}
    </div>
  )
}
