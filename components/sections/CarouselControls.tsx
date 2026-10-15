'use client'

import { Pause, Play } from 'lucide-react'
import { cn } from '@stellr/web-ui'

/**
 * Dots plus a pause button for a carousel. Each dot is a 24px target (WCAG
 * 2.5.8) with a smaller visible mark inside; the pause button lets anyone stop
 * auto-rotation (WCAG 2.2.2).
 */
export function CarouselControls({
  count,
  index,
  onShow,
  label,
  canRotate,
  paused,
  onTogglePause,
  tone = 'dark',
  className,
}: {
  count: number
  index: number
  onShow: (i: number) => void
  /** e.g. "Show quote" → "Show quote 2" */
  label: string
  canRotate: boolean
  paused: boolean
  onTogglePause: () => void
  /** Surface the controls sit on. */
  tone?: 'dark' | 'light'
  className?: string
}) {
  if (count < 2) return null
  const dark = tone === 'dark'
  return (
    <div className={cn('flex items-center justify-center gap-1', className)}>
      {canRotate && (
        <button
          type="button"
          onClick={onTogglePause}
          aria-label={paused ? 'Play the slideshow' : 'Pause the slideshow'}
          className={cn(
            'mr-1 inline-flex h-8 w-8 items-center justify-center rounded-full',
            dark ? 'text-white/80 hover:bg-white/10' : 'text-content-secondary hover:bg-surface'
          )}
        >
          {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
        </button>
      )}
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onShow(i)}
          aria-label={`${label} ${i + 1}`}
          aria-current={i === index ? 'true' : undefined}
          className="group inline-flex h-6 min-w-6 items-center justify-center"
        >
          <span
            aria-hidden
            className={cn(
              'block h-2 rounded-full transition-all',
              i === index ? 'w-6' : 'w-2',
              i === index ? (dark ? 'bg-white' : 'bg-primary-deep') : dark ? 'bg-white/45 group-hover:bg-white/70' : 'bg-line-strong group-hover:bg-content-muted'
            )}
          />
        </button>
      ))}
    </div>
  )
}
