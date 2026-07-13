// Interactive-lesson registry metadata: keys + admin labels only, no component
// imports, so this is safe to import anywhere (API routes, server queries, admin
// selects). The key → component map lives in lib/interactive-lessons.tsx — keep
// the two in sync (the registry unit test enforces it).
//
// Keys are code-defined (not free text) so a training_item can never reference a
// component that doesn't exist: the admin UI offers only these keys, the items API
// rejects anything else, and the player falls back to 'unavailable' for unknown
// keys left behind by a removed component.

export const INTERACTIVE_LESSON_META = {
  'atmospheric-requirements': {
    label: 'Atmospheric Requirements for Space Settlements',
  },
} as const satisfies Record<string, { label: string }>

export type InteractiveKey = keyof typeof INTERACTIVE_LESSON_META

export const INTERACTIVE_OPTIONS = Object.entries(INTERACTIVE_LESSON_META).map(
  ([key, v]) => ({ key: key as InteractiveKey, label: v.label }),
)

export function isInteractiveKey(k: string | null | undefined): k is InteractiveKey {
  return !!k && k in INTERACTIVE_LESSON_META
}
