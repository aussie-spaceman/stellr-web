import { Mic } from 'lucide-react'
import { Eyebrow } from '@stellr/web-ui'
import type { AudioAsset } from '@/lib/media-helpers'

/**
 * Audio-only testimonial: native <audio> controls (keyboard and screen-reader
 * operable, nothing loads until play) with the full transcript printed beneath,
 * so the clip is accessible without sound. `transcript` is one line per turn,
 * "Speaker: words".
 */
export function AudioTestimonial({ audio, className = '' }: { audio: AudioAsset; className?: string }) {
  const lines = audio.transcript.split('\n').filter(Boolean)
  return (
    <figure className={`rounded-panel border border-line bg-white p-6 shadow-card ${className}`}>
      <figcaption className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Mic className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="font-display text-sm font-bold text-ink">{audio.title}</span>
      </figcaption>
      <audio controls preload="none" className="mt-4 w-full" aria-label={`Audio: ${audio.title}`}>
        <source src={audio.src} type="audio/mp4" />
        Your browser doesn&rsquo;t support embedded audio.
      </audio>
      <div className="mt-5 border-t border-line-light pt-4">
        <Eyebrow className="text-content-faint">Transcript</Eyebrow>
        <div className="mt-2 space-y-2 text-ds-body text-content-secondary">
          {lines.map((line, i) => {
            const at = line.indexOf(': ')
            return at > 0 ? (
              <p key={i}>
                <span className="font-semibold text-ink">{line.slice(0, at)}:</span> {line.slice(at + 2)}
              </p>
            ) : (
              <p key={i}>{line}</p>
            )
          })}
        </div>
      </div>
    </figure>
  )
}
