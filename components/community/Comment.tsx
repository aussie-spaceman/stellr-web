'use client'

import { useState } from 'react'
import { RichTextContent } from './RichTextContent'
import { CommentForm } from './CommentForm'
import { ReactionBar } from './ReactionBar'
import { FlagButton } from './FlagButton'
import { Avatar } from '@/components/ui/Avatar'

export interface CommentNode {
  id: string
  postId: string
  authorName: string
  createdAt: string
  bodyJson: unknown
  reactions: { emoji: string; count: number; reactedByMe: boolean }[]
  replies: CommentNode[]
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// Single comment with reactions and a one-level reply affordance (FR-COM-02).
export function Comment({ node, depth = 0 }: { node: CommentNode; depth?: number }) {
  const [replying, setReplying] = useState(false)
  const canNest = depth < 1 // one level of nesting

  return (
    <div className={depth > 0 ? 'mt-3 border-l-2 border-brand-hairline pl-4' : ''}>
      <div className="rounded-lg bg-white p-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-brand-muted-soft">
          <Avatar id={node.authorName} name={node.authorName} size="sm" ring={false} />
          <span className="font-medium text-brand-muted">{node.authorName}</span>
          <span>·</span>
          <span>{timeAgo(node.createdAt)}</span>
        </div>
        <RichTextContent doc={node.bodyJson} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ReactionBar targetType="comment" targetId={node.id} initial={node.reactions} />
            {canNest && (
              <button
                onClick={() => setReplying((r) => !r)}
                className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted"
              >
                Reply
              </button>
            )}
          </div>
          <FlagButton contentType="comment" contentId={node.id} />
        </div>
        {replying && (
          <div className="mt-3">
            <CommentForm
              postId={node.postId}
              parentCommentId={node.id}
              compact
              placeholder="Write a reply…"
              onDone={() => setReplying(false)}
            />
          </div>
        )}
      </div>

      {node.replies.map((child) => (
        <Comment key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  )
}
