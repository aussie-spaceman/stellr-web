'use client'

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from './primitives'

/**
 * The one overlay for every surface. On a phone it is a bottom sheet; from
 * `sm` it is centred. Either way it never grows past the screen (dvh, so the
 * on-screen keyboard and Safari's toolbars are accounted for): the body
 * scrolls and the footer stays put, so the submit button is always reachable,
 * in landscape too.
 *
 * Accessibility: role="dialog" (or "alertdialog") named by its title, focus
 * moves in on open and back to the trigger on close, Tab is held inside, the
 * rest of the page is `inert` (so VoiceOver can't swipe behind it), Escape and
 * the scrim close it unless `dismissible` is false, and the close button is a
 * 44px target.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const SIZE: Record<DialogSize, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Names the dialog. Always required; use `hideTitle` to keep it for screen readers only. */
  title: ReactNode
  /** A line under the title; also the dialog's description. */
  description?: ReactNode
  children: ReactNode
  /** Actions, pinned under the scrolling body. */
  footer?: ReactNode
  size?: DialogSize
  /** False while something must finish (a submit in flight): no Escape, no scrim, no close button. */
  dismissible?: boolean
  /** Where focus goes on open. Defaults to the first field or button in the body. */
  initialFocusRef?: RefObject<HTMLElement | null>
  hideTitle?: boolean
  /** "alertdialog" for a confirmation that interrupts. */
  role?: 'dialog' | 'alertdialog'
  className?: string
  bodyClassName?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[inert]'))
}

// Open dialogs, innermost last: only the top one answers Escape, and the
// scroll lock lifts when the last one closes.
const stack: string[] = []

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'lg',
  dismissible = true,
  initialFocusRef,
  hideTitle = false,
  role = 'dialog',
  className,
  bodyClassName,
}: DialogProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descId = `${id}-desc`
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  // Held in refs so a parent re-render (an inline onClose) doesn't re-run the
  // open/close effect, which would steal focus back to the first field.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open || !mounted) return
    const root = rootRef.current
    const panel = panelRef.current
    if (!root || !panel) return

    const returnTo = document.activeElement as HTMLElement | null
    stack.push(id)

    // Everything else on the page goes inert while this is open.
    const madeInert: HTMLElement[] = []
    for (const el of Array.from(document.body.children) as HTMLElement[]) {
      // A live region (the toaster) stays live, or a "Saved" raised from
      // inside the dialog would never be announced.
      if (el === root || el.hasAttribute('inert') || el.tagName === 'SCRIPT' || el.hasAttribute('data-keep-active')) continue
      el.setAttribute('inert', '')
      madeInert.push(el)
    }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const first = initialFocusRef?.current ?? (bodyRef.current && focusables(bodyRef.current)[0]) ?? panel
    first.focus({ preventScroll: true })

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return
      if (e.key === 'Escape') {
        if (dismissibleRef.current) {
          e.preventDefault()
          onCloseRef.current()
        }
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(panel)
      if (items.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === firstItem || active === panel)) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault()
        firstItem.focus()
      } else if (!panel.contains(active)) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const at = stack.lastIndexOf(id)
      if (at !== -1) stack.splice(at, 1)
      for (const el of madeInert) el.removeAttribute('inert')
      if (stack.length === 0) document.body.style.overflow = prevOverflow
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true })
    }
    // initialFocusRef is read once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, id])

  if (!open || !mounted) return null

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-midnight/60"
        onClick={() => dismissibleRef.current && onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex w-full flex-col bg-white shadow-panel outline-none',
          // Phone: a sheet from the bottom edge, clear of the home indicator.
          'max-h-[calc(100dvh-1rem)] rounded-t-ds-card pb-[env(safe-area-inset-bottom)]',
          'sm:max-h-[calc(100dvh-2rem)] sm:rounded-ds-card sm:pb-0',
          SIZE[size],
          className,
        )}
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-5 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className={cn('font-heading text-xl font-bold leading-snug text-ink', hideTitle && 'sr-only')}>
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-content-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label="Close"
              className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-content-muted transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </header>
        <div ref={bodyRef} className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6', bodyClassName)}>
          {children}
        </div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-4 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Asks before something that can't be undone. The confirm button gets focus,
 * so Enter confirms and Escape backs out.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      initialFocusRef={confirmRef}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-control px-4 text-sm font-semibold text-content-secondary hover:bg-surface disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              'min-h-11 rounded-control px-4 text-sm font-semibold text-white disabled:opacity-60',
              tone === 'danger' ? 'bg-danger hover:opacity-90' : 'bg-primary-deep hover:bg-ink',
            )}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {null}
    </Dialog>
  )
}
