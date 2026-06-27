'use client'

import { ReactRenderer } from '@tiptap/react'
import type { MentionOptions } from '@tiptap/extension-mention'
import type { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'

export interface MentionItem {
  id: string
  label: string
  role?: string | null
}

interface MentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

function formatRole(role: string): string {
  return role
    .replace('school_student_manager', 'Student Mgr')
    .replace('participant', 'Student')
    .replace('teacher', 'Educator')
    .replace('mentor', 'Mentor')
    .replace('parent', 'Parent')
}

// The dropdown rendered under the caret while typing "@name". Mounted manually
// (no tippy dependency) — see mentionSuggestion().render below.
const MentionList = forwardRef<
  MentionListRef,
  { items: MentionItem[]; command: (item: { id: string; label: string }) => void }
>(function MentionList({ items, command }, ref) {
  const [index, setIndex] = useState(0)
  useEffect(() => setIndex(0), [items])

  const select = (i: number) => {
    const item = items[i]
    if (item) command({ id: item.id, label: item.label })
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false
      if (event.key === 'ArrowUp') {
        setIndex((i) => (i + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        select(index)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) return null

  return (
    <div className="w-56 overflow-hidden rounded-lg border border-brand-border bg-white py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          type="button"
          key={item.id}
          onMouseDown={(e) => {
            e.preventDefault()
            command({ id: item.id, label: item.label })
          }}
          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm ${
            i === index ? 'bg-brand-hairline' : ''
          }`}
        >
          <span className="font-medium text-brand-blue-dark">{item.label}</span>
          {item.role && <span className="text-xs text-brand-muted-soft">{formatRole(item.role)}</span>}
        </button>
      ))}
    </div>
  )
})

// Suggestion config for the Mention extension. Fetches directory-visible members
// from the mention-search API and renders the dropdown. If the request fails or
// the member is unauthenticated the list is simply empty (no crash).
export function mentionSuggestion(): MentionOptions['suggestion'] {
  return {
    items: async ({ query }): Promise<MentionItem[]> => {
      if (!query) return []
      try {
        const res = await fetch(`/api/community/members/mention-search?q=${encodeURIComponent(query)}`)
        if (!res.ok) return []
        const json = await res.json()
        return (json.members ?? []) as MentionItem[]
      } catch {
        return []
      }
    },
    render: () => {
      let component: ReactRenderer<MentionListRef> | null = null
      let el: HTMLDivElement | null = null

      const place = (clientRect?: (() => DOMRect | null) | null) => {
        if (!el || !clientRect) return
        const rect = clientRect()
        if (!rect) return
        el.style.left = `${rect.left + window.scrollX}px`
        el.style.top = `${rect.bottom + window.scrollY + 4}px`
      }

      const teardown = () => {
        el?.remove()
        el = null
        component?.destroy()
        component = null
      }

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor })
          el = document.createElement('div')
          el.style.position = 'absolute'
          el.style.zIndex = '50'
          document.body.appendChild(el)
          el.appendChild(component.element)
          place(props.clientRect)
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps(props)
          place(props.clientRect)
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === 'Escape') {
            teardown()
            return true
          }
          return component?.ref?.onKeyDown(props) ?? false
        },
        onExit: teardown,
      }
    },
  }
}
