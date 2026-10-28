'use client'

import { CarouselControls } from './CarouselControls'
import { useAutoRotate } from './useAutoRotate'

interface Quote {
  quote: string
  author: string
}

interface QuoteRotatorProps {
  quotes: Quote[]
  /** Auto-advance interval in milliseconds. */
  intervalMs?: number
}

/**
 * Auto-rotating banner of community quotes (home "Hear From Our Community",
 * on a dark background). Cross-fades between quotes; pauses on hover, focus,
 * a tap, the pause button, reduced motion and off-screen.
 *
 * The quotes are stacked in one grid cell rather than absolutely positioned,
 * so the box takes the height of the longest quote: on a 320px phone a long
 * quote used to spill over the heading and the dots.
 */
export function QuoteRotator({ quotes, intervalMs = 7000 }: QuoteRotatorProps) {
  const rotate = useAutoRotate(quotes.length, intervalMs)
  if (!quotes.length) return null

  return (
    <div className="mx-auto max-w-3xl">
      <div
        {...rotate.bind}
        role="group"
        aria-roledescription="carousel"
        aria-label="What our community says"
        className="grid px-4 text-center [&>*]:[grid-area:1/1]"
      >
        {quotes.map((q, i) => (
          <figure
            key={q.author + i}
            className={`flex flex-col items-center justify-center transition-opacity duration-700 motion-reduce:transition-none ${
              i === rotate.index ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={i !== rotate.index}
          >
            <blockquote className="text-xl font-medium italic leading-relaxed text-white sm:text-2xl sm:leading-8">
              &ldquo;{q.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-4 font-semibold text-hero-dim">— {q.author}</figcaption>
          </figure>
        ))}
      </div>

      <CarouselControls
        className="mt-6"
        tone="dark"
        count={quotes.length}
        index={rotate.index}
        onShow={rotate.show}
        label="Show quote"
        canRotate={rotate.canRotate}
        paused={rotate.userPaused}
        onTogglePause={rotate.togglePause}
      />
    </div>
  )
}
