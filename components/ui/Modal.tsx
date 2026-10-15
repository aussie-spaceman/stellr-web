'use client'

import type { ReactNode } from 'react'
import { Dialog, type DialogSize } from '@stellr/web-ui'

interface Props {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Max width in px from sm up. Defaults to 520. */
  maxWidth?: number
}

/** The nearest Dialog width to a pixel width (Tailwind's max-w scale). */
export function dialogSizeFor(px: number): DialogSize {
  if (px <= 384) return 'sm'
  if (px <= 448) return 'md'
  if (px <= 520) return 'lg'
  if (px <= 576) return 'xl'
  if (px <= 672) return '2xl'
  return '3xl'
}

// The Spaces modal API, kept for its call sites, on the shared Dialog: a
// bottom sheet on phones, capped to the screen, focus held inside.
export function Modal({ open, onClose, title, subtitle, children, footer, maxWidth = 520 }: Props) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={subtitle}
      footer={footer}
      size={dialogSizeFor(maxWidth)}
    >
      {children}
    </Dialog>
  )
}
