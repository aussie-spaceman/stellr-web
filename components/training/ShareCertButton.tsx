'use client'

import { useState } from 'react'
import { Share2, Check } from 'lucide-react'

// Copies a shareable link to the certificate. Uses the verify URL so a recipient
// can confirm the certificate number.
export function ShareCertButton({ certNumber }: { certNumber: string }) {
  const [copied, setCopied] = useState(false)
  const share = async () => {
    const url = `${window.location.origin}/community/training?cert=${encodeURIComponent(certNumber)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My Stellr certificate', url })
      } else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {
      /* user dismissed share sheet — no-op */
    }
  }
  return (
    <button
      onClick={share}
      className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-brand-muted transition hover:bg-brand-canvas"
    >
      {copied ? <Check className="h-4 w-4 text-[#158463]" /> : <Share2 className="h-4 w-4" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  )
}
