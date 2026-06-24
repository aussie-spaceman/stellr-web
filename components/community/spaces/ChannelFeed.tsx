'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { Paperclip, Pin, MessageSquare, Flag, FileText, X } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase-browser'
import { Avatar } from '@/components/ui/Avatar'
import { ReactionBar } from '@/components/community/ReactionBar'
import { FlagModal } from '@/components/community/spaces/FlagModal'
import { TierPill, RolePill } from '@/components/community/spaces/badges'
import { toast } from '@/components/ui/Toast'
import type { FeedPost, FeedReply } from '@/lib/space-posts'

interface Props {
  spaceSlug: string
  channelId: string
  channelSlug: string
  channelName: string
  selfId: string
  canPost: boolean
  allowUploads: boolean
  initialPosts: FeedPost[]
}

function textToTiptap(text: string) {
  const paras = text.split(/\n+/).map((line) => ({
    type: 'paragraph',
    content: line ? [{ type: 'text', text: line }] : [],
  }))
  return { type: 'doc', content: paras.length ? paras : [{ type: 'paragraph' }] }
}

function fmtAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

// Channel feed (screen 02): composer + post cards with reactions, threaded
// replies, attachments, and flagging. Streams live via Supabase Realtime
// (Clerk-token), falling back to an 8s poll — mirrors ChatPanel.
export function ChannelFeed({
  spaceSlug,
  channelId,
  channelSlug,
  channelName,
  selfId,
  canPost,
  allowUploads,
  initialPosts,
}: Props) {
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts)
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [flag, setFlag] = useState<{ type: 'post' | 'comment'; id: string; label?: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { getToken } = useAuth()

  const load = useCallback(async () => {
    const res = await fetch(`/api/community/posts?channelId=${channelId}`)
    if (res.ok) {
      const json = await res.json()
      setPosts(json.posts ?? [])
    }
  }, [channelId])

  // Poll fallback.
  useEffect(() => {
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [load])

  // Realtime push on new/changed posts in this channel.
  useEffect(() => {
    let channel: ReturnType<ReturnType<typeof createBrowserSupabase>['channel']> | null = null
    try {
      const sb = createBrowserSupabase(getToken)
      channel = sb
        .channel(`channel:${channelId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'community_posts', filter: `channel_id=eq.${channelId}` },
          () => load()
        )
        .subscribe()
    } catch {
      /* realtime optional — polling covers it */
    }
    return () => {
      channel?.unsubscribe()
    }
  }, [channelId, getToken, load])

  const submit = async () => {
    if (!draft.trim() && !file) return
    setSending(true)
    try {
      const res = await fetch('/api/community/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceSlug, channelSlug, bodyJson: textToTiptap(draft.trim()) }),
      })
      if (!res.ok) {
        toast('Could not post')
        return
      }
      const { id } = await res.json()
      if (file && id) {
        const form = new FormData()
        form.append('file', file)
        form.append('spaceSlug', spaceSlug)
        form.append('postId', id)
        const up = await fetch('/api/community/resources/attach', { method: 'POST', body: form })
        if (up.ok) toast('File saved to Resources')
        else toast('Posted, but the file failed to attach')
      }
      setDraft('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      await load()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mx-auto max-w-[720px]">
      <header className="mb-4">
        <h1 className="font-heading text-[21px] text-brand-blue-dark"># {channelName}</h1>
        <p className="text-xs text-brand-muted-soft">Channel in this space</p>
      </header>

      {canPost && (
        <div className="mb-5 rounded-[14px] border border-brand-border bg-white p-3 shadow-card">
          <div className="flex gap-3">
            <Avatar id={selfId} name="You" size="md" ring={false} />
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder="Start a post — share an update, ask a question…"
              className="min-h-[44px] flex-1 resize-none rounded-lg border border-brand-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
            />
          </div>
          {file && (
            <div className="mt-2 flex items-center gap-2 rounded-md bg-brand-canvas px-2 py-1 text-xs text-brand-muted">
              <FileText className="h-3.5 w-3.5" /> {file.name}
              <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }} aria-label="Remove file">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between">
            {allowUploads ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-brand-muted-soft hover:text-brand-muted">
                <Paperclip className="h-3.5 w-3.5" /> Attach file — saved to Resources
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            ) : (
              <span />
            )}
            <button
              onClick={submit}
              disabled={sending || (!draft.trim() && !file)}
              className="rounded-lg bg-brand-blue px-4 py-1.5 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {sending ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {posts.length === 0 && (
          <p className="py-10 text-center text-sm text-brand-muted-soft">
            No posts yet. {canPost ? 'Be the first to start a discussion.' : ''}
          </p>
        )}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} selfId={selfId} onFlag={(label) => setFlag({ type: 'post', id: p.id, label })} onChanged={load} onFlagReply={(id) => setFlag({ type: 'comment', id })} canReply={canPost} />
        ))}
      </div>

      {flag && (
        <FlagModal
          open
          onClose={() => setFlag(null)}
          contentType={flag.type}
          contentId={flag.id}
          label={flag.label}
        />
      )}
    </div>
  )
}

function PostCard({
  post,
  selfId,
  onFlag,
  onFlagReply,
  onChanged,
  canReply,
}: {
  post: FeedPost
  selfId: string
  onFlag: (label?: string) => void
  onFlagReply: (id: string) => void
  onChanged: () => void
  canReply: boolean
}) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const sendReply = async () => {
    if (!reply.trim()) return
    setBusy(true)
    const res = await fetch('/api/community/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: post.id, bodyJson: textToTiptap(reply.trim()) }),
    })
    setBusy(false)
    if (res.ok) {
      setReply('')
      setReplying(false)
      onChanged()
    } else {
      toast('Could not reply')
    }
  }

  return (
    <article className="rounded-[16px] border border-brand-border bg-white p-4 shadow-card">
      {post.isAnnouncement && (
        <div
          className="mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-subheading font-semibold uppercase tracking-[0.05em]"
          style={{ background: '#FBEFDD', color: '#B5711F' }}
        >
          <Pin className="h-3 w-3" /> Pinned announcement
        </div>
      )}
      <div className="flex items-start gap-3">
        <Avatar id={post.authorId ?? post.authorName} name={post.authorName} size="md" ring={false} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-subheading font-semibold text-brand-blue-dark">{post.authorName}</span>
            {post.tierName && <TierPill name={post.tierName} />}
            {post.role && post.role !== 'member' && <RolePill role={post.role} />}
            <span className="text-xs text-brand-muted-soft">· {fmtAgo(post.createdAt)}</span>
          </div>
          {post.title && <h3 className="mt-1 font-heading text-[15px] text-brand-blue-dark">{post.title}</h3>}
          {post.bodyText && <p className="mt-1 whitespace-pre-wrap text-sm text-brand-muted">{post.bodyText}</p>}

          {post.attachment && (
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs text-brand-muted">
              <FileText className="h-4 w-4 text-brand-blue" />
              {post.attachment.name}
              <span className="rounded bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase text-brand-muted-soft">
                {post.attachment.fileType ?? 'file'}
              </span>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <ReactionBar targetType="post" targetId={post.id} initial={post.reactions} />
            {canReply && (
              <button
                onClick={() => setReplying((v) => !v)}
                className="flex items-center gap-1 text-xs text-brand-muted-soft hover:text-brand-muted"
              >
                <MessageSquare className="h-3.5 w-3.5" /> Reply
                {post.replies.length > 0 && ` (${post.replies.length})`}
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => onFlag(post.title ?? undefined)}
          aria-label="Report this post"
          className="text-brand-muted-soft hover:text-red-500"
        >
          <Flag className="h-3.5 w-3.5" />
        </button>
      </div>

      {(post.replies.length > 0 || replying) && (
        <div className="mt-3 space-y-3 border-t border-brand-hairline pt-3 pl-11">
          {post.replies.map((r) => (
            <ReplyRow key={r.id} reply={r} onFlag={() => onFlagReply(r.id)} />
          ))}
          {replying && (
            <div className="flex gap-2">
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={1}
                placeholder="Write a reply…"
                className="min-h-[40px] flex-1 resize-none rounded-lg border border-brand-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
              />
              <button
                onClick={sendReply}
                disabled={busy || !reply.trim()}
                className="rounded-lg bg-brand-blue px-3 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function ReplyRow({ reply, onFlag }: { reply: FeedReply; onFlag: () => void }) {
  return (
    <div className="flex items-start gap-2">
      <Avatar id={reply.authorId ?? reply.authorName} name={reply.authorName} size="sm" ring={false} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-subheading font-semibold text-brand-blue-dark">{reply.authorName}</span>
          {reply.tierName && <TierPill name={reply.tierName} />}
          {reply.role && reply.role !== 'member' && <RolePill role={reply.role} />}
        </div>
        {reply.bodyText && <p className="mt-0.5 whitespace-pre-wrap text-sm text-brand-muted">{reply.bodyText}</p>}
        <div className="mt-1">
          <ReactionBar targetType="comment" targetId={reply.id} initial={reply.reactions} />
        </div>
      </div>
      <button onClick={onFlag} aria-label="Report this reply" className="text-brand-muted-soft hover:text-red-500">
        <Flag className="h-3 w-3" />
      </button>
    </div>
  )
}
