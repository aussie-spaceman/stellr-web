'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { CarouselControls } from './CarouselControls'
import { useAutoRotate } from './useAutoRotate'

export interface StudentWorkSlide {
  src: string
  alt: string
}

/**
 * Rotating showcase of previous student competition work. The page passes the
 * images (lib/media-manifest STUDENT_WORK); with six or fewer it shows them
 * all, in order, and auto-cycles. Larger pools would pick a random six after
 * hydration so each visit shows a different mix without a mismatch.
 *
 * The slides are PNGs on the media host (up to ~600 KB each); next/image
 * serves them as AVIF/WebP at the width the frame needs. Rotation pauses on
 * hover, focus, a tap, the pause button, reduced motion, and off-screen.
 */
const SHOW = 6
const INTERVAL_MS = 5000

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
  const rotate = useAutoRotate(slides.length, INTERVAL_MS)

  useEffect(() => {
    if (images.length > SHOW) setSlides(pickRandom(images, SHOW))
  }, [images])

  if (slides.length === 0) {
    return <div className={`aspect-[16/9] w-full rounded-2xl border border-line bg-surface animate-pulse ${className}`} />
  }

  return (
    <div className={className}>
      <div
        {...rotate.bind}
        role="group"
        aria-roledescription="carousel"
        aria-label="Previous student work"
        className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-line bg-midnight shadow-card-lift"
      >
        {slides.map((s, i) => (
          <Image
            key={s.src}
            src={s.src}
            alt={s.alt}
            fill
            sizes="(min-width: 1024px) 540px, 100vw"
            className={`object-contain transition-opacity duration-700 motion-reduce:transition-none ${i === rotate.index ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden={i !== rotate.index}
          />
        ))}
      </div>
      <CarouselControls
        className="mt-2"
        tone="light"
        count={slides.length}
        index={rotate.index}
        onShow={rotate.show}
        label="Show student work"
        canRotate={rotate.canRotate}
        paused={rotate.userPaused}
        onTogglePause={rotate.togglePause}
      />
    </div>
  )
}
