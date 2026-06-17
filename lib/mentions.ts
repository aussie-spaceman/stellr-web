import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'

type TipTapNode = { type?: string; attrs?: Record<string, unknown>; content?: TipTapNode[] }

/**
 * Collect the unique member ids referenced by `mention` nodes inside a stored
 * TipTap document. Safe to call on null/unknown shapes.
 */
export function extractMentionIds(doc: unknown): string[] {
  const ids = new Set<string>()
  const walk = (node: TipTapNode | undefined) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'mention') {
      const id = node.attrs?.id
      if (typeof id === 'string' && id) ids.add(id)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  walk(doc as TipTapNode)
  return [...ids]
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

/**
 * Notify members @mentioned in a post or comment (notification type 'mention',
 * already defined in lib/notify). Best-effort — never throws into the caller.
 *
 * Privacy / safeguarding gate: only members who have opted into the directory
 * (member_directory_prefs.is_visible) are mentionable — the same set the
 * autocomplete offers. Opting out of discoverability therefore also opts out of
 * being mentioned. The server re-validates here because a client could put
 * arbitrary ids in body_json. To loosen this later (e.g. allow mentioning any
 * member who can access the space), change only the visibility query below.
 */
export async function notifyMentions(opts: {
  mentionIds: string[]
  actorMemberId: string
  actorName: string
  context: 'post' | 'comment'
  postId: string
  spaceSlug: string
  /** Members to skip (e.g. the post author, who already gets a 'reply'). */
  excludeIds?: string[]
}): Promise<void> {
  const exclude = new Set([opts.actorMemberId, ...(opts.excludeIds ?? [])])
  const candidates = [...new Set(opts.mentionIds)].filter((id) => !exclude.has(id))
  if (candidates.length === 0) return

  const db = supabaseServer()
  const { data: visible } = await db
    .from('member_directory_prefs')
    .select('member_id')
    .in('member_id', candidates)
    .eq('is_visible', true)

  const allowed = (visible ?? []).map((r) => r.member_id as string)
  if (allowed.length === 0) return

  const postUrl = `${APP_URL}/community/${opts.spaceSlug}/${opts.postId}`
  const where = opts.context === 'post' ? 'a post' : 'a comment'
  const body = `${opts.actorName} mentioned you in ${where}`

  await Promise.all(
    allowed.map((id) =>
      notifyMember(id, {
        type: 'mention',
        body,
        actorMemberId: opts.actorMemberId,
        referenceType: 'post',
        referenceId: opts.postId,
        email: {
          subject: body,
          html: `<p>${body}.</p><p><a href="${postUrl}">View the conversation</a></p>`,
          text: `${body}. View it: ${postUrl}`,
        },
      }).catch((e) => console.error('[community] mention notify failed:', e)),
    ),
  )
}
