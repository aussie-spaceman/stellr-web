import { Download, Mic } from 'lucide-react'
import type { AudioAsset } from '@/lib/media-helpers'

/**
 * Audio-only testimonial: native <audio> controls (keyboard and screen-reader
 * operable, nothing loads until play) with the transcript offered as a PDF
 * download beneath, so the clip is accessible without sound.
 */
export function AudioTestimonial({ audio, className = '' }: { audio: AudioAsset; className?: string }) {
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
      <a
        href={audio.transcriptHref}
        download
        className="mt-4 inline-flex items-center gap-1.5 text-ds-body font-semibold text-primary hover:text-primary-deep"
      >
        <Download className="h-4 w-4" aria-hidden="true" /> Download the transcript (PDF)
      </a>
    </figure>
  )
}
