'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ThemeDot } from './badges'
import { toast } from '@/components/ui/Toast'
import type { PendingInvite } from '@/lib/spaces'

// Pending-invite banner on the Spaces directory (screen 01). Accepting grants
// access and moves the space into "Your spaces"; declining dismisses the banner.
export function InviteBanner({ invite }: { invite: PendingInvite }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'accept' | 'decline'>(null)
  const [done, setDone] = useState(false)

  const respond = async (action: 'accept' | 'decline') => {
    setBusy(action)
    const res = await fetch('/api/community/spaces/invite/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spaceId: invite.spaceId, action }),
    })
    setBusy(null)
    if (!res.ok) {
      toast('Could not update the invite')
      return
    }
    setDone(true)
    toast(action === 'accept' ? `Joined ${invite.spaceName}` : 'Invite declined')
    router.refresh()
  }

  if (done) return null

  const roleLabel = invite.role.charAt(0).toUpperCase() + invite.role.slice(1)

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-[14px] px-[18px] py-[14px]"
      style={{ background: '#EAF0FE', border: '1px solid #C9D8FB' }}
    >
      <ThemeDot theme={invite.theme} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-brand-blue-dark">
          {invite.inviterName ? <strong>{invite.inviterName}</strong> : 'An admin'} invited you to join{' '}
          <strong>{invite.spaceName}</strong>
        </p>
        <p className="text-xs text-brand-muted-soft">Invited as {roleLabel} · accept to gain access</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => respond('decline')}
          disabled={!!busy}
          className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm font-subheading font-semibold text-brand-muted transition-colors hover:bg-brand-canvas disabled:opacity-50"
        >
          {busy === 'decline' ? 'Declining…' : 'Decline'}
        </button>
        <button
          type="button"
          onClick={() => respond('accept')}
          disabled={!!busy}
          className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-subheading font-semibold text-white transition-colors hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {busy === 'accept' ? 'Joining…' : 'Accept invite'}
        </button>
      </div>
    </div>
  )
}
