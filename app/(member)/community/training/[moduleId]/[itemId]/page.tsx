import { redirect } from 'next/navigation'

// The lesson player was consolidated into the course-detail page, where the
// current lesson is a ?lesson= param (player + outline on one screen). This stub
// keeps old /community/training/[moduleId]/[itemId] links working.
export default async function LegacyLessonRedirect({
  params,
}: {
  params: Promise<{ moduleId: string; itemId: string }>
}) {
  const { moduleId, itemId } = await params
  redirect(`/community/training/${moduleId}?lesson=${itemId}`)
}
