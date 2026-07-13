import { describe, it, expect } from 'vitest'
import {
  INTERACTIVE_LESSON_META,
  INTERACTIVE_OPTIONS,
  isInteractiveKey,
} from '@/lib/interactive-lessons-meta'
import { INTERACTIVE_LESSONS } from '@/lib/interactive-lessons'

describe('interactive-lesson registry', () => {
  it('registers the atmospheric-requirements tutorial', () => {
    expect(INTERACTIVE_LESSON_META['atmospheric-requirements']).toBeDefined()
    expect(INTERACTIVE_LESSONS['atmospheric-requirements']).toBeTypeOf('function')
  })

  it('keeps meta and component maps in sync', () => {
    expect(Object.keys(INTERACTIVE_LESSONS).sort()).toEqual(Object.keys(INTERACTIVE_LESSON_META).sort())
  })

  it('gives every option a key and a non-empty label', () => {
    expect(INTERACTIVE_OPTIONS.length).toBeGreaterThan(0)
    for (const o of INTERACTIVE_OPTIONS) {
      expect(o.key in INTERACTIVE_LESSON_META).toBe(true)
      expect(o.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('isInteractiveKey accepts registered keys and rejects everything else', () => {
    expect(isInteractiveKey('atmospheric-requirements')).toBe(true)
    expect(isInteractiveKey('not-a-tutorial')).toBe(false)
    expect(isInteractiveKey('')).toBe(false)
    expect(isInteractiveKey(null)).toBe(false)
    expect(isInteractiveKey(undefined)).toBe(false)
  })
})
