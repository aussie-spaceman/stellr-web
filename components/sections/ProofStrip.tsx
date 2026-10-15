'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { PhotoAsset } from '@/lib/media-helpers'
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
  /** Desktop column count — 1 for a single centred photo, 2 for large 50/50
   *  thumbnails, 3/5 for strips. */
  columns?: 1 | 2 | 3 | 4 | 5
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
  const single = columns === 1

  return (
    <div className={className}>
      {heading && <h3 className="mb-4 font-display text-lg font-bold text-ink">{heading}</h3>}

      {/* Strip: scroll-snap row on mobile, responsive grid ≥sm. `relative` makes
          the list the containing block for the photos' absolutely positioned
          (sr-only) credits; without it they escaped the scroller and widened
          /network to 867px on every phone. */}
      <ul className={single
        ? 'relative mx-auto max-w-2xl'
        : `relative -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 ${columns === 2 ? 'sm:grid-cols-2 lg:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : columns === 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : 'sm:grid-cols-3 lg:grid-cols-3'}`}>
        {photos.map((p, i) => (
          <li key={p.id} className={single ? 'w-full' : 'w-[78%] shrink-0 snap-start sm:w-auto'}>
            <button
              type="button"
              onClick={() => show(i)}
              className="group block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label={`Open photo: ${p.alt}`}
            >
              <ResponsivePhoto
                photo={p}
                sizes={single ? '(max-width: 672px) 100vw, 672px' : '(max-width: 640px) 78vw, (max-width: 1024px) 33vw, 220px'}
                className="aspect-[4/3] transition-transform group-hover:-translate-y-0.5"
              />
              {captions && (
                <>
                  <p className="mt-2 text-[13px] leading-snug text-content-secondary">{p.caption ?? p.alt}</p>
                  {p.credit && (
                    <p className="text-[11px] text-content-faint">{p.credit}</p>
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
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-midnight-deep/90 px-2 py-4 outline-none sm:p-4"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4 sm:top-4"
          >
            <X className="h-5 w-5" />
          </button>

          {/* On a phone the arrows sit over the photo, so it can use the full
              width (beside it, they shrank photos to about 230px). */}
          <div className="relative flex w-full max-w-5xl items-center gap-3" onClick={(e) => e.stopPropagation()}>
            {photos.length > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="absolute left-1 top-1/2 z-10 flex h-11 w-11 shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-midnight-deep/60 text-white transition-colors hover:bg-white/20 sm:static sm:translate-y-0 sm:bg-white/10"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}
            <figure className="min-w-0 flex-1">
              <ResponsivePhoto
                photo={active}
                sizes="(max-width: 1024px) 100vw, 960px"
                priority
                className="max-h-[78svh] bg-black"
                imgClassName="object-contain"
              />
              <figcaption className="mt-3 text-center text-sm text-white/90">
                {active.caption ?? active.alt}
                {active.credit && <span className="ml-2 text-white/55">· {active.credit}</span>}
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
                className="absolute right-1 top-1/2 z-10 flex h-11 w-11 shrink-0 -translate-y-1/2 items-center justify-center rounded-full bg-midnight-deep/60 text-white transition-colors hover:bg-white/20 sm:static sm:translate-y-0 sm:bg-white/10"
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
