'use client'

import { useState } from 'react'

const EMOJI_CHOICES = ['👍', '🎉', '❤️', '🤔', '👏']

interface ReactionState {
  emoji: string
  count: number
  reactedByMe: boolean
}

interface Props {
  targetType: 'post' | 'comment'
  targetId: string
  initial: ReactionState[]
}

// Emoji reactions with optimistic toggle. Backed by /api/community/reactions.
export function ReactionBar({ targetType, targetId, initial }: Props) {
  const [reactions, setReactions] = useState<ReactionState[]>(initial)
  const [picking, setPicking] = useState(false)

  const toggle = async (emoji: string) => {
    setPicking(false)
    // Optimistic update
    setReactions((prev) => {
      const found = prev.find((r) => r.emoji === emoji)
      if (found) {
        const next = prev.map((r) =>
          r.emoji === emoji
            ? { ...r, reactedByMe: !r.reactedByMe, count: r.count + (r.reactedByMe ? -1 : 1) }
            : r
        )
        return next.filter((r) => r.count > 0)
      }
      return [...prev, { emoji, count: 1, reactedByMe: true }]
    })

    try {
      await fetch('/api/community/reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, emoji }),
      })
    } catch {
      // On failure, revert by re-toggling locally.
      setReactions((prev) => {
        const found = prev.find((r) => r.emoji === emoji)
        if (!found) return prev
        const next = prev.map((r) =>
          r.emoji === emoji
            ? { ...r, reactedByMe: !r.reactedByMe, count: r.count + (r.reactedByMe ? -1 : 1) }
            : r
        )
        return next.filter((r) => r.count > 0)
      })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => toggle(r.emoji)}
          className={[
            'flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition',
            r.reactedByMe
              ? 'border-brand-blue/30 bg-brand-blue/5 text-brand-blue'
              : 'border-brand-border bg-white text-brand-muted hover:border-brand-border',
          ].join(' ')}
        >
          <span>{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}

      <div className="relative">
        <button
          onClick={() => setPicking((p) => !p)}
          className="rounded-full border border-brand-border bg-white px-2 py-0.5 text-xs text-brand-muted-soft hover:border-brand-border hover:text-brand-muted"
          aria-label="Add reaction"
        >
          + 😊
        </button>
        {picking && (
          <div className="absolute z-10 mt-1 flex gap-1 rounded-lg border border-brand-border bg-white p-1.5 shadow-sm">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                onClick={() => toggle(e)}
                className="rounded px-1 text-base hover:bg-brand-hairline"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
