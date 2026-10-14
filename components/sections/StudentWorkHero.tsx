'use client'

import { useEffect, useState } from 'react'

export interface StudentWorkSlide {
  src: string
  alt: string
}

/**
 * Rotating showcase of previous student competition work. The page passes the
 * images (lib/media-manifest STUDENT_WORK); with six or fewer it shows them
 * all, in order, and auto-cycles. Larger pools would pick a random six after
 * hydration so each visit shows a different mix without a mismatch.
 */
const SHOW = 6
const INTERVAL_MS = 4000

function pickRandom<T>(pool: T[], n: number) {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

export function StudentWorkHero({ images, className = '' }: { images: StudentWorkSlide[]; className?: string }) {
  const [slides, setSlides] = useState<StudentWorkSlide[]>(() => (images.length <= SHOW ? images : []))
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    if (images.length > SHOW) setSlides(pickRandom(images, SHOW))
  }, [images])

  useEffect(() => {
    if (slides.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), INTERVAL_MS)
    return () => clearInterval(t)
  }, [slides])

  if (slides.length === 0) {
    return (
      <div
        className={`aspect-[16/9] w-full rounded-2xl border border-line bg-surface animate-pulse ${className}`}
      />
    )
  }

  return (
    <div
      className={`relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-line bg-[#0E1330] shadow-card-lift ${className}`}
    >
      {slides.map((s, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- media-host image; the slides are already sized for the frame
        <img
          key={s.src}
          src={s.src}
          alt={s.alt}
          loading={i === 0 ? 'eager' : 'lazy'}
          decoding="async"
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ${i === idx ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={i !== idx}
        />
      ))}
      {slides.length > 1 && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Show student work ${i + 1}`}
              aria-current={i === idx}
              onClick={() => setIdx(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
