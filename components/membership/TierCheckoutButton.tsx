'use client'

import { useState } from 'react'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

interface TierCheckoutButtonProps {
  tierName: string
  label?: string
  className?: string
}

export function TierCheckoutButton({ tierName, label, className }: TierCheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/membership-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierName, billingInterval: 'annual' }),
      })
      if (res.status === 401) {
        window.location.href = `${AUTH_URL}/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`
        return
      }
      const data = await res.json() as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('[TierCheckoutButton] error:', data.error)
        setLoading(false)
      }
    } catch (err) {
      console.error('[TierCheckoutButton] failed:', err)
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={className}
    >
      {loading ? 'Redirecting…' : (label ?? `Get ${tierName}`)}
    </button>
  )
}
