import type { ComponentType } from 'react'
import { AtmosphericRequirements } from '@/components/interactive/atmospheric-requirements'
import type { InteractiveKey } from '@/lib/interactive-lessons-meta'

// Code-defined registry: maps each interactive-lesson key to its client component.
// Keys/labels live in lib/interactive-lessons-meta.ts (import that from server-only
// code — this file pulls in 'use client' components). Add new tutorials in both.
export const INTERACTIVE_LESSONS: Record<InteractiveKey, ComponentType> = {
  'atmospheric-requirements': AtmosphericRequirements,
}
