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
    <div className="w-56 max-w-full overflow-hidden rounded-lg border border-brand-border bg-white py-1 shadow-lg">
      {items.map((item, i) => (
        <button
          type="button"
          key={item.id}
          onMouseDown={(e) => {
            e.preventDefault()
            command({ id: item.id, label: item.label })
          }}
          // 44px rows to tap on a touch screen; compact under a mouse.
          className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm mouse:min-h-0 ${
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

const GAP = 4
const EDGE = 8
// Used before the list has rendered and been measured.
const FALLBACK_HEIGHT = 240

/**
 * Where the @mention list goes, in screen (fixed) coordinates. It sits under
 * the caret if it fits there, otherwise above it when there is more room
 * above (the keyboard has taken the bottom of the screen), and it is kept
 * inside the visible area left to right. maxWidth / maxHeight cap it to the
 * room it got; it scrolls inside that.
 */
export function placeMentionMenu(
  caret: { left: number; top: number; bottom: number },
  menu: { width: number; height: number },
  view: { left: number; top: number; width: number; height: number },
): { left: number; top: number; maxWidth: number; maxHeight: number } {
  const viewRight = view.left + view.width
  const viewBottom = view.top + view.height
  const maxWidth = Math.max(0, view.width - EDGE * 2)
  const width = Math.min(menu.width, maxWidth)
  const left = Math.max(view.left + EDGE, Math.min(caret.left, viewRight - EDGE - width))

  const height = menu.height || FALLBACK_HEIGHT
  const below = viewBottom - caret.bottom - GAP - EDGE
  const above = caret.top - view.top - GAP - EDGE
  if (height <= below || below >= above) {
    return { left, top: caret.bottom + GAP, maxWidth, maxHeight: Math.max(0, below) }
  }
  const shown = Math.min(height, above)
  return { left, top: caret.top - GAP - shown, maxWidth, maxHeight: Math.max(0, above) }
}

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
      let clientRect: (() => DOMRect | null) | null | undefined = null
      let frame = 0

      // Fixed to the screen and placed within what can actually be seen: the
      // visual viewport, which on a phone is the part above the on-screen
      // keyboard (and is offset from the page while Safari pans it).
      const place = () => {
        if (!el || !clientRect) return
        const rect = clientRect()
        if (!rect) return
        const vv = window.visualViewport
        const view = {
          left: vv?.offsetLeft ?? 0,
          top: vv?.offsetTop ?? 0,
          width: vv?.width ?? window.innerWidth,
          height: vv?.height ?? window.innerHeight,
        }
        const pos = placeMentionMenu(rect, { width: el.offsetWidth, height: el.scrollHeight }, view)
        el.style.left = `${pos.left}px`
        el.style.top = `${pos.top}px`
        el.style.maxWidth = `${pos.maxWidth}px`
        el.style.maxHeight = `${pos.maxHeight}px`
      }
      // The list renders after the first placement, so place again once it
      // has a size (and whenever the keyboard or a scroll moves things).
      const schedule = () => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(place)
      }

      const teardown = () => {
        cancelAnimationFrame(frame)
        window.visualViewport?.removeEventListener('resize', schedule)
        window.visualViewport?.removeEventListener('scroll', schedule)
        window.removeEventListener('scroll', schedule, true)
        el?.remove()
        el = null
        component?.destroy()
        component = null
      }

      return {
        onStart: (props: SuggestionProps<MentionItem>) => {
          component = new ReactRenderer(MentionList, { props, editor: props.editor })
          el = document.createElement('div')
          el.style.position = 'fixed'
          el.style.zIndex = '50'
          el.style.overflowY = 'auto'
          el.style.overscrollBehavior = 'contain'
          document.body.appendChild(el)
          el.appendChild(component.element)
          clientRect = props.clientRect
          place()
          schedule()
          window.visualViewport?.addEventListener('resize', schedule)
          window.visualViewport?.addEventListener('scroll', schedule)
          window.addEventListener('scroll', schedule, true)
        },
        onUpdate: (props: SuggestionProps<MentionItem>) => {
          component?.updateProps(props)
          clientRect = props.clientRect
          place()
          schedule()
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
