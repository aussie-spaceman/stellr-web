'use client'

import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  title?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Max width in px. Defaults to 520. */
  maxWidth?: number
}

// Shared modal: centered, navy scrim, click-outside / ✕ / Esc to close, click
// inside does not close. Matches the Spaces design tokens (radius 18, lifted
// shadow). Use for every Spaces modal (New Space, Invite, Assign, Manage, Flag).
export function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 520 }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,14,34,.5)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[90vh] w-full overflow-y-auto rounded-[18px] bg-white"
        style={{ maxWidth, boxShadow: '0 30px 70px -20px rgba(10,14,34,.55)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-brand-muted-soft transition-colors hover:bg-brand-canvas hover:text-brand-muted"
        >
          <X className="h-4 w-4" />
        </button>
        {(title || subtitle) && (
          <header className="px-6 pb-2 pt-6 pr-12">
            {title && <h2 className="font-heading text-[20px] text-brand-blue-dark">{title}</h2>}
            {subtitle && <p className="mt-1 text-sm text-brand-muted-soft">{subtitle}</p>}
          </header>
        )}
        <div className="px-6 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-3 border-t border-brand-hairline px-6 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  )
}
