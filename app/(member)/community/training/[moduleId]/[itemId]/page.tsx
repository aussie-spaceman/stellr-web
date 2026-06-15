import { redirect, notFound } from 'next/navigation'
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
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm text-gray-400">
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
        className="aspect-video w-full rounded-xl border border-gray-200"
      />
    )
  }

  if (media.type === 'document') {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <iframe src={media.url} title={title} className="h-[70vh] w-full bg-white" />
        <div className="flex items-center justify-end border-t border-gray-100 bg-gray-50 px-3 py-2">
          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
        </div>
      </div>
    )
  }

  // External link we can't embed — offer a clean open button.
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-gray-200 bg-gray-50">
      <FileText className="h-8 w-8 text-gray-300" />
      <a
        href={media.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
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
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link
            href={`/community/training/${moduleId}`}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft className="h-4 w-4" />
            {lesson.moduleTitle}
          </Link>
          <span className="ml-auto text-xs text-gray-400">
            Lesson {lesson.index} of {lesson.total}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-4 text-2xl font-bold text-gray-900">{lesson.title}</h1>

          {lesson.locked ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
              <Lock className="h-8 w-8 text-amber-400" />
              <p className="text-sm font-medium text-gray-700">This lesson isn’t available yet</p>
              {lesson.availableAt && (
                <p className="text-sm text-gray-500">
                  Unlocks {new Date(lesson.availableAt).toLocaleDateString()}
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
                <div className="prose prose-sm mt-6 max-w-none whitespace-pre-wrap text-gray-700">
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
