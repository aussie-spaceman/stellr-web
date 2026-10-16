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
 * Files live in the `stellr-media` Blob store under videos/ (720p H.264 MP4 +
 * .poster.jpg + .en.vtt), resolved via `mediaUrl()` (lib/media-helpers). The
 * host is cross-origin, so the <video> is `crossOrigin="anonymous"` — without
 * it browsers refuse to load the captions <track>.
 * The poster shows from `posterSrcSet`, WebP copies cut once at upload, so it
 * never goes through the next/image optimizer (whose resizes count against
 * the Hobby team's monthly quota).
 * `captionsSrc` is strongly recommended; if absent the component still renders
 * but logs a dev warning so a caption-less clip never ships unnoticed.
 */
export function VideoTestimonial({
  src,
  poster,
  posterSrcSet,
  captionsSrc,
  title = 'Stellr testimonial',
  captionsLabel = 'English',
  className = '',
}: {
  src: string
  poster?: string
  /** Pre-sized WebP copies of `poster` (VideoAsset.posterSrcSet). */
  posterSrcSet?: string
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
            // Lazy-loaded (these sit below the fold on every page that uses
            // them), and from the srcset at the frame's width rather than the
            // full-size poster (up to ~240 KB).
            // eslint-disable-next-line @next/next/no-img-element -- pre-sized srcset on the media host; next/image would re-encode it
            <img
              src={poster}
              srcSet={posterSrcSet}
              sizes="(min-width: 1024px) 540px, 100vw"
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
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
          crossOrigin="anonymous"
          controls
          autoPlay
          preload="none"
          poster={poster}
          title={title}
          aria-label={title}
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
