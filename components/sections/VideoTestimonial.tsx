'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'

/**
 * T2 — Inline click-to-play video. 16:9 framed player that shows only the
 * poster until tapped, then loads + plays the self-hosted MP4 (README §6/§9):
 *   • preload="none" — nothing fetched until the viewer opts in
 *   • poster-first — a still + play affordance, no autoload
 *   • WebVTT captions track present (required for accessibility / sound-off)
 *
 * Files live in /public/videos (web-optimized H.264 MP4 + .poster.jpg + .en.vtt).
 * `captionsSrc` is strongly recommended; if absent the component still renders
 * but logs a dev warning so a caption-less clip never ships unnoticed.
 */
export function VideoTestimonial({
  src,
  poster,
  captionsSrc,
  title = 'Stellr testimonial',
  captionsLabel = 'English',
  className = '',
}: {
  src: string
  poster?: string
  captionsSrc?: string
  title?: string
  captionsLabel?: string
  className?: string
}) {
  const [playing, setPlaying] = useState(false)

  if (!captionsSrc && process.env.NODE_ENV !== 'production') {
    console.warn(`[VideoTestimonial] "${title}" has no captionsSrc — captions are required (README §9).`)
  }

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black shadow-card-lift ${className}`}
    >
      {!playing ? (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play video: ${title}`}
          className="group absolute inset-0 h-full w-full cursor-pointer"
        >
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element -- poster is a single above-the-fold still; <img> keeps the click-to-play swap simple
            <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 bg-[linear-gradient(160deg,#20264F,#0E1330)]" />
          )}
          <span className="absolute inset-0 bg-black/15 transition-colors group-hover:bg-black/25" />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow-card-lift transition-transform group-hover:scale-105">
            <Play className="ml-0.5 h-6 w-6 fill-ink text-ink" />
          </span>
        </button>
      ) : (
        <video
          controls
          autoPlay
          preload="none"
          poster={poster}
          title={title}
          className="absolute inset-0 h-full w-full"
        >
          <source src={src} type="video/mp4" />
          {captionsSrc && (
            <track kind="captions" src={captionsSrc} srcLang="en" label={captionsLabel} default />
          )}
          Your browser doesn&rsquo;t support embedded video.
        </video>
      )}
    </div>
  )
}
