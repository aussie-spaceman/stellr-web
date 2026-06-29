'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'

/**
 * Rotating showcase of previous student competition work. On mount it randomly
 * selects 6 images from the pool and auto-cycles through them. Selection is
 * client-only (after hydration) so each visit shows a different mix without a
 * hydration mismatch. Images live in /public/student-work.
 */
const POOL = Array.from(
  { length: 12 },
  (_, i) => `/student-work/student-work-${String(i + 1).padStart(2, '0')}.png`,
)
const SHOW = 6
const INTERVAL_MS = 4000

function pickRandom(pool: string[], n: number) {
  const a = [...pool]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

export function StudentWorkHero({ className = '' }: { className?: string }) {
  const [slides, setSlides] = useState<string[]>([])
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    setSlides(pickRandom(POOL, SHOW))
  }, [])

  useEffect(() => {
    if (slides.length === 0) return
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
      {slides.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt="Previous student competition work"
          fill
          sizes="(max-width: 768px) 100vw, 60vw"
          className={`object-contain transition-opacity duration-700 ${i === idx ? 'opacity-100' : 'opacity-0'}`}
          priority={i === 0}
        />
      ))}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Show student work ${i + 1}`}
            onClick={() => setIdx(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/70'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
