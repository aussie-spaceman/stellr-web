'use client'

import { useEffect, useState } from 'react'

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
 * Auto-rotating banner of community quotes. Cross-fades between quotes on a
 * timer, pauses while hovered, and exposes clickable dots for manual control.
 * Rendered on a dark background (home "Hear From Our Community" section).
 */
export function QuoteRotator({ quotes, intervalMs = 6000 }: QuoteRotatorProps) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || quotes.length < 2) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % quotes.length)
    }, intervalMs)
    return () => clearInterval(id)
  }, [paused, quotes.length, intervalMs])

  if (!quotes.length) return null

  const current = quotes[index]

  return (
    <div
      className="max-w-3xl mx-auto"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative min-h-[10rem] flex items-center justify-center text-center px-4">
        {quotes.map((q, i) => (
          <figure
            key={q.author + i}
            className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-700 ${
              i === index ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            aria-hidden={i !== index}
          >
            <blockquote className="text-xl sm:text-2xl font-medium italic leading-relaxed text-white">
              &ldquo;{q.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-blue-300 font-semibold">— {q.author}</figcaption>
          </figure>
        ))}
      </div>

      {quotes.length > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          {quotes.map((q, i) => (
            <button
              key={q.author + i}
              onClick={() => setIndex(i)}
              aria-label={`Show quote ${i + 1}`}
              aria-current={i === index}
              className={`h-2.5 rounded-full transition-all ${
                i === index ? 'w-8 bg-brand-blue' : 'w-2.5 bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
