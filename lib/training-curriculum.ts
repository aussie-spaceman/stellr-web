// Where each lesson sits in a course, as the Course builder drags it around.
// Pure, so the moves and what gets saved can be tested without a browser.

/** Layout key for lessons with no section. */
export const UNSECTIONED = '__unsectioned__'

export type LessonLayout = Record<string, string[]>

export interface PlacedLesson {
  id: string
  section_id: string | null
  display_order: number
}

export interface LessonMove {
  id: string
  sectionId: string | null
  displayOrder: number
}

export const sectionKey = (sectionId: string | null) => sectionId ?? UNSECTIONED

export function buildLayout(lessons: PlacedLesson[], sectionIds: string[]): LessonLayout {
  const layout: LessonLayout = {}
  for (const id of sectionIds) layout[id] = []
  layout[UNSECTIONED] = []
  const sorted = [...lessons].sort((a, b) => a.display_order - b.display_order)
  for (const l of sorted) {
    // A lesson pointing at a section this course no longer has still shows up.
    const key = l.section_id && layout[l.section_id] ? l.section_id : UNSECTIONED
    layout[key].push(l.id)
  }
  return layout
}

function findLesson(layout: LessonLayout, id: string): { key: string; index: number } | null {
  for (const key of Object.keys(layout)) {
    const index = layout[key].indexOf(id)
    if (index !== -1) return { key, index }
  }
  return null
}

/** Put a lesson at an index in a section. toIndex is read after the lesson is lifted out. */
export function moveLesson(layout: LessonLayout, id: string, toKey: string, toIndex: number): LessonLayout {
  const from = findLesson(layout, id)
  if (!from || !layout[toKey]) return layout
  const without = layout[from.key].filter((x) => x !== id)
  const base = from.key === toKey ? without : layout[toKey]
  const index = Math.max(0, Math.min(toIndex, base.length))
  if (from.key === toKey && index === from.index) return layout
  const next = { ...layout, [from.key]: without }
  next[toKey] = [...base.slice(0, index), id, ...base.slice(index)]
  return next
}

/**
 * One step up or down for the arrow buttons. At the edge of a section it crosses
 * into the neighbouring section, so dragging is never the only way to move one.
 * keys is the order the sections appear in on screen.
 */
export function stepLesson(layout: LessonLayout, id: string, dir: -1 | 1, keys: string[]): LessonLayout {
  const from = findLesson(layout, id)
  if (!from) return layout
  const within = from.index + dir
  if (within >= 0 && within < layout[from.key].length) return moveLesson(layout, id, from.key, within)
  const neighbour = keys[keys.indexOf(from.key) + dir]
  if (neighbour === undefined || keys.indexOf(from.key) === -1) return layout
  return moveLesson(layout, id, neighbour, dir === -1 ? layout[neighbour].length : 0)
}

/** Whether stepLesson could move this lesson at all. */
export function canStep(layout: LessonLayout, id: string, dir: -1 | 1, keys: string[]): boolean {
  return stepLesson(layout, id, dir, keys) !== layout
}

/** Only what differs from what is saved, so a small move sends a small request. */
export function layoutMoves(layout: LessonLayout, saved: Map<string, { sectionId: string | null; displayOrder: number }>): LessonMove[] {
  const moves: LessonMove[] = []
  for (const key of Object.keys(layout)) {
    const sectionId = key === UNSECTIONED ? null : key
    layout[key].forEach((id, displayOrder) => {
      const was = saved.get(id)
      if (!was || was.sectionId !== sectionId || was.displayOrder !== displayOrder) moves.push({ id, sectionId, displayOrder })
    })
  }
  return moves
}
