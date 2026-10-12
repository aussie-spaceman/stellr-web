import 'server-only'
import { supabaseServer } from '@/lib/supabase'

type Db = ReturnType<typeof supabaseServer>

export interface DeleteBlocker {
  table: string
  label: string
  count: number
}

// deep review DB-4 (safeguarding / data-retention): deleting a community space
// or a mentoring/coaching cohort used to issue a raw `.delete()`, and the FK
// cascades then HARD-removed everything hanging off it — chat messages
// (chat_messages.channel_id → chat_channels.space_id / cohort_id, all ON DELETE
// CASCADE), posts and their comments (community_posts/community_comments), and
// the moderation record that explains why someone was removed
// (community_space_suspensions.space_id CASCADE). Those are exactly the
// adult↔minor communication and moderation records a safeguarding investigation
// would need, and the project has no database backups
// (docs/compliance/retention-schedule.md row 15), so the loss is irreversible.
//
// The safe default (an owner data-retention decision — see the PR) is to
// PRESERVE, not silently cascade: block the hard delete whenever any such record
// exists and steer the admin to Archive (archiveCohort / archiveWorkshop / the
// space's is_archived flag), which keeps every row and only closes the chat.
// An empty space/cohort (e.g. one created by mistake with no activity) can still
// be deleted outright.
export class CommunityDeleteBlockedError extends Error {
  constructor(public blockers: DeleteBlocker[]) {
    super('Delete blocked: communication/moderation records exist — archive instead')
    this.name = 'CommunityDeleteBlockedError'
  }
}

// Fail CLOSED: a lookup error must NEVER be read as "no records" — that would let
// the cascade delete safeguarding data on a transient DB hiccup. A thrown plain
// Error surfaces as a 500 (delete does not proceed); only a proven-non-empty
// count throws CommunityDeleteBlockedError (409). Only a proven-empty result lets
// the delete through.
async function exactCount(
  // The supabase-js query builder is awaitable and resolves to { count, error }.
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
  what: string,
): Promise<number> {
  const { count, error } = await query
  if (error) throw new Error(`[community-delete-guard] count ${what} failed: ${error.message}`)
  return count ?? 0
}

// Count chat messages that cascade away when a space or cohort row is deleted.
// Messages hang off chat_channels (keyed by space_id for 'space' channels,
// cohort_id for 'cohort'/'coaching' channels), so resolve the channel ids first.
async function chatMessageCount(db: Db, key: { spaceId: string } | { cohortId: string }): Promise<number> {
  const col = 'spaceId' in key ? 'space_id' : 'cohort_id'
  const val = 'spaceId' in key ? key.spaceId : key.cohortId
  const { data: channels, error } = await db.from('chat_channels').select('id').eq(col, val)
  if (error) throw new Error(`[community-delete-guard] chat_channels lookup failed: ${error.message}`)
  const ids = (channels ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return 0
  return exactCount(
    db.from('chat_messages').select('id', { count: 'exact', head: true }).in('channel_id', ids),
    'chat_messages',
  )
}

/**
 * deep review DB-4: throw CommunityDeleteBlockedError if deleting this space would
 * cascade away any posts, chat messages or suspension records. Posts are counted
 * directly; community_comments.post_id is NOT NULL ON DELETE CASCADE, so any
 * comment implies a post — counting posts already covers posts+comments.
 */
export async function assertSpaceDeletable(db: Db, spaceId: string): Promise<void> {
  const blockers: DeleteBlocker[] = []

  const posts = await exactCount(
    db.from('community_posts').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
    'community_posts',
  )
  if (posts > 0) blockers.push({ table: 'community_posts', label: 'posts', count: posts })

  const messages = await chatMessageCount(db, { spaceId })
  if (messages > 0) blockers.push({ table: 'chat_messages', label: 'chat messages', count: messages })

  const suspensions = await exactCount(
    db.from('community_space_suspensions').select('member_id', { count: 'exact', head: true }).eq('space_id', spaceId),
    'community_space_suspensions',
  )
  if (suspensions > 0) blockers.push({ table: 'community_space_suspensions', label: 'moderation/suspension records', count: suspensions })

  if (blockers.length > 0) throw new CommunityDeleteBlockedError(blockers)
}

/**
 * deep review DB-4: throw CommunityDeleteBlockedError if deleting this cohort /
 * workshop would cascade away its chat history (adult↔minor group or 1:1 chat).
 * Shared by mentoring deleteCohort and coaching deleteWorkshop (both delete a
 * mentoring_cohorts row).
 */
export async function assertCohortDeletable(db: Db, cohortId: string): Promise<void> {
  const messages = await chatMessageCount(db, { cohortId })
  if (messages > 0) {
    throw new CommunityDeleteBlockedError([
      { table: 'chat_messages', label: 'chat messages', count: messages },
    ])
  }
}
