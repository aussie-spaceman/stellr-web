'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { type PhotoAsset } from '@/lib/media-manifest'
import { ResponsivePhoto } from './ResponsivePhoto'

/**
 * T3 — Proof strip / gallery. A row of 3–5 captioned photos (horizontal scroll
 * on mobile, grid on desktop). Clicking any photo opens a lightbox that is
 * focus-trapped, Esc-closes, and arrow-key navigable (README §9). Student work
 * shows its credit line.
 */
export function ProofStrip({
  photos,
  heading,
  columns = 5,
  captions = true,
  className = '',
}: {
  photos: PhotoAsset[]
  heading?: string
  /** Desktop column count — use 3 so a 3-photo strip fills (centres on) the row. */
  columns?: 3 | 5
  /** Show the per-photo caption + credit line under each image. */
  captions?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<HTMLElement | null>(null)

  const show = useCallback((i: number) => {
    lastFocused.current = document.activeElement as HTMLElement
    setIndex(i)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    lastFocused.current?.focus()
  }, [])

  const step = useCallback(
    (delta: number) => setIndex((i) => (i + delta + photos.length) % photos.length),
    [photos.length],
  )

  // Body scroll lock + focus management while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Tab') {
      // Trap focus among the dialog's buttons.
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  if (photos.length === 0) return null
  const active = photos[index]

  return (
    <div className={className}>
      {heading && <h3 className="mb-4 font-display text-lg font-bold text-ink">{heading}</h3>}

      {/* Strip: scroll-snap row on mobile, responsive grid ≥sm */}
      <ul className={`-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 ${columns === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`}>
        {photos.map((p, i) => (
          <li key={p.id} className="w-[78%] shrink-0 snap-start sm:w-auto">
            <button
              type="button"
              onClick={() => show(i)}
              className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label={`Open photo: ${p.alt}`}
            >
              <ResponsivePhoto
                photo={p}
                sizes="(max-width: 640px) 78vw, (max-width: 1024px) 33vw, 220px"
                className="aspect-[4/3] transition-transform group-hover:-translate-y-0.5"
              />
              {captions && (
                <>
                  <p className="mt-2 text-[13px] leading-snug text-content-secondary">{p.alt}</p>
                  {p.credit && (
                    <p className="text-[11px] text-content-faint">Credit: {p.credit}</p>
                  )}
                </>
              )}
            </button>
          </li>
        ))}
      </ul>

      {/* Lightbox */}
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={active.alt}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) close()
          }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 outline-none"
          style={{ background: 'rgba(8,12,28,.82)' }}
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="flex w-full max-w-5xl items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            <figure className="min-w-0 flex-1">
              <ResponsivePhoto
                photo={active}
                sizes="(max-width: 1024px) 90vw, 960px"
                priority
                className="max-h-[78vh] bg-black"
                imgClassName="object-contain"
              />
              <figcaption className="mt-3 text-center text-sm text-white/90">
                {active.alt}
                {active.credit && <span className="ml-2 text-white/55">· Credit: {active.credit}</span>}
                {photos.length > 1 && (
                  <span className="ml-2 text-white/55">
                    ({index + 1}/{photos.length})
                  </span>
                )}
              </figcaption>
            </figure>
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next photo"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
