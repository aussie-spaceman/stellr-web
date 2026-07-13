import { ExternalLink, FileText, Play, Download, AlertTriangle } from 'lucide-react'
import type { LessonMedia as LessonMediaType } from '@/lib/training'
import { VideoRoom } from '@/components/video/VideoRoom'
import { FlagResourceButton } from '@/components/training/FlagResourceButton'
import { InteractiveLessonHost } from '@/components/training/InteractiveLessonHost'
import { isInteractiveKey } from '@/lib/interactive-lessons-meta'

// Renders the featured media for a lesson inside the course-detail player surface.
// Shared by the course-detail page (and any standalone lesson view).
export function LessonMedia({
  media,
  title,
  displayName,
  itemId,
}: {
  media: LessonMediaType
  title: string
  displayName: string
  itemId: string
}) {
  if (!media) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-gradient-to-br from-[#13183A] to-[#0E1330] text-sm text-white/60">
        <span className="flex flex-col items-center gap-2">
          <Play className="h-9 w-9 text-white/70" />
          No media for this lesson yet
        </span>
      </div>
    )
  }

  // An interactive lesson whose key is no longer in the registry (component
  // removed) degrades to the same unavailable state — never a crash or blank slot.
  if (media.type === 'unavailable' || (media.type === 'interactive' && !isInteractiveKey(media.key))) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-[#13183A] to-[#0E1330] px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-300" />
        <p className="text-sm font-medium text-white/80">This resource is currently unavailable</p>
        <p className="max-w-sm text-xs text-white/50">
          The material for this lesson hasn&apos;t been published yet. Let us know and we&apos;ll get it sorted.
        </p>
        <FlagResourceButton itemId={itemId} />
      </div>
    )
  }

  if (media.type === 'interactive') {
    return <InteractiveLessonHost lessonKey={media.key} />
  }

  if (media.type === 'live') {
    return (
      <VideoRoom
        scriptSrc={media.scriptSrc}
        domain={media.domain}
        roomName={media.roomName}
        jwt={media.jwt}
        displayName={displayName}
        className="aspect-video w-full overflow-hidden rounded-2xl bg-black"
      />
    )
  }

  if (media.type === 'video') {
    return <video controls controlsList="nodownload" src={media.url} className="aspect-video w-full rounded-2xl bg-black" />
  }

  if (media.type === 'embed') {
    return (
      <iframe
        src={media.src}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="aspect-video w-full rounded-2xl border border-brand-border"
      />
    )
  }

  if (media.type === 'document') {
    // PDFs render natively in an iframe; Office documents (docx/pptx/xlsx) do not,
    // so route those through the Google Docs viewer instead of showing a blank frame.
    const isOffice = /\.(docx?|pptx?|xlsx?)(\?|#|$)/i.test(media.url)
    const frameSrc = isOffice
      ? `https://docs.google.com/viewer?url=${encodeURIComponent(media.url)}&embedded=true`
      : media.url
    return (
      <div className="overflow-hidden rounded-2xl border border-brand-border">
        <iframe src={frameSrc} title={title} className="h-[60vh] w-full bg-white" />
        <div className="flex items-center justify-end border-t border-brand-hairline bg-brand-canvas px-3 py-2">
          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-muted hover:text-brand-blue-dark"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-gradient-to-br from-[#13183A] to-[#0E1330]">
      <FileText className="h-8 w-8 text-white/70" />
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-bright"
      >
        <ExternalLink className="h-4 w-4" /> Open lesson
      </a>
    </div>
  )
}
