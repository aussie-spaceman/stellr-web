import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { notifyCommunityAdmins } from '@/lib/notify'
import { supabaseServer } from '@/lib/supabase'

// A member reports that a training lesson's resource is unavailable/broken
// (e.g. no link provided, or a placeholder like "TBC"). Routes an in-app +
// email alert to community admins so they can fix or replace it.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('id, title, module_id, training_modules(title)')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'Lesson not found' }, { status: 404 })

  const moduleTitle = (item.training_modules as { title?: string } | null)?.title ?? 'a course'
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email
  const lessonTitle = (item.title as string) ?? 'a lesson'

  await notifyCommunityAdmins({
    type: 'action',
    body: `${memberName} reported an unavailable resource in "${lessonTitle}" (${moduleTitle}).`,
    referenceType: 'training_item',
    referenceId: itemId,
    actorMemberId: member.id,
    email: {
      subject: `Training resource flagged: ${lessonTitle}`,
      html: `<p><strong>${memberName}</strong> reported that the resource for the lesson <strong>${lessonTitle}</strong> in <strong>${moduleTitle}</strong> is unavailable.</p><p>Review it in Admin → Academy → Training.</p>`,
      text: `${memberName} reported that the resource for "${lessonTitle}" in "${moduleTitle}" is unavailable. Review it in Admin → Academy → Training.`,
    },
  })

  return NextResponse.json({ ok: true })
}
