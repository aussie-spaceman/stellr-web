'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Index state for an auto-advancing carousel that follows WCAG 2.2.2 (pause,
 * stop, hide) and doesn't waste a phone's battery:
 *
 * - never auto-advances for people who ask for reduced motion;
 * - stops while the pointer is over it, while anything inside has focus, and
 *   after any tap or click inside (a touch screen has no hover to pause on);
 * - has a user-controlled pause the page shows as a button;
 * - stops while scrolled out of view or while the tab is hidden.
 *
 * Spread `bind` onto the carousel's root element.
 */
export function useAutoRotate(count: number, intervalMs: number) {
  const [index, setIndex] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [visible, setVisible] = useState(true)
  const [reducedMotion, setReducedMotion] = useState(false)
  const rootRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const running = count > 1 && !reducedMotion && !userPaused && !hovered && !focused && visible

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setIndex((i) => (i + 1) % count)
    }, intervalMs)
    return () => clearInterval(id)
  }, [running, count, intervalMs])

  // Keep the index in range when the number of items changes.
  useEffect(() => {
    if (index >= count) setIndex(0)
  }, [count, index])

  const ref = useCallback((el: HTMLElement | null) => {
    rootRef.current = el
  }, [])

  return {
    index,
    /** Showing a specific item is a choice: it stops the rotation. */
    show: (i: number) => {
      setIndex(i)
      setUserPaused(true)
    },
    /** Rotation is possible at all (more than one item, motion allowed). */
    canRotate: count > 1 && !reducedMotion,
    running,
    userPaused,
    togglePause: () => setUserPaused((p) => !p),
    bind: {
      ref,
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') setHovered(true)
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') setHovered(false)
      },
      onPointerDown: () => setUserPaused(true),
      onFocus: () => setFocused(true),
      onBlur: (e: React.FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      },
    },
  }
}
