import { redirect, notFound } from 'next/navigation'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, Lock, ExternalLink, FileText, Download } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getLesson } from '@/lib/training'
import { CompleteLessonBar } from '@/components/community/CompleteLessonBar'
import { VideoRoom } from '@/components/video/VideoRoom'

export const metadata = { title: 'Community · Lesson' }

function Media({
  media,
  title,
  displayName,
}: {
  media: NonNullable<Awaited<ReturnType<typeof getLesson>>>['media']
  title: string
  displayName: string
}) {
  if (!media) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-brand-border bg-brand-canvas text-sm text-brand-muted-soft">
        No media for this lesson.
      </div>
    )
  }

  if (media.type === 'live') {
    return (
      <VideoRoom
        scriptSrc={media.scriptSrc}
        domain={media.domain}
        roomName={media.roomName}
        jwt={media.jwt}
        displayName={displayName}
        className="aspect-video w-full overflow-hidden rounded-xl bg-black"
      />
    )
  }

  if (media.type === 'video') {
    return (
      <video
        controls
        controlsList="nodownload"
        src={media.url}
        className="aspect-video w-full rounded-xl bg-black"
      />
    )
  }

  if (media.type === 'embed') {
    return (
      <iframe
        src={media.src}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        className="aspect-video w-full rounded-xl border border-brand-border"
      />
    )
  }

  if (media.type === 'document') {
    return (
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <iframe src={media.url} title={title} className="h-[70vh] w-full bg-white" />
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

  // External link we can't embed — offer a clean open button.
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-brand-border bg-brand-canvas">
      <FileText className="h-8 w-8 text-brand-muted-soft" />
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-dark px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark"
      >
        <ExternalLink className="h-4 w-4" /> Open lesson
      </a>
    </div>
  )
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ moduleId: string; itemId: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { moduleId, itemId } = await params
  const lesson = await getLesson(member, moduleId, itemId)
  if (!lesson) notFound()

  return (
    <div className="-mx-4 -my-8 flex min-h-screen flex-col">
      {/* Top bar */}
      <div className="border-b border-brand-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href={`/community/training/${moduleId}`}
            className="inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-blue-dark"
          >
            <ArrowLeft className="h-4 w-4" />
            {lesson.moduleTitle}
          </Link>
          <span className="ml-auto text-xs text-brand-muted-soft">
            Lesson {lesson.index} of {lesson.total}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 font-heading uppercase text-title text-brand-blue-dark">{lesson.title}</h1>

          {lesson.locked ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-brand-border bg-brand-canvas py-16 text-center">
              <Lock className="h-8 w-8 text-brand-gold-ink" />
              <p className="text-sm font-medium text-brand-muted">This lesson isn’t available yet</p>
              {lesson.availableAt && (
                <p className="text-sm text-brand-muted-soft">
                  Unlocks {formatDateShort(lesson.availableAt)}
                </p>
              )}
            </div>
          ) : (
            <>
              <Media
                media={lesson.media}
                title={lesson.title}
                displayName={[member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'}
              />
              {lesson.body && (
                <div className="prose prose-sm mt-6 max-w-none whitespace-pre-wrap text-brand-muted">
                  {lesson.body}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {!lesson.locked && (
        <CompleteLessonBar
          moduleId={moduleId}
          itemId={itemId}
          prevId={lesson.prevId}
          nextId={lesson.nextId}
          completed={lesson.completed}
        />
      )}
    </div>
  )
}
