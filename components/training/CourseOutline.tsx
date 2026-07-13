import Link from 'next/link'
import { Check, Play, FileText, ExternalLink, Lock, Sparkles } from 'lucide-react'
import type { TrainingSection, TrainingItem } from '@/lib/training'

// Right-hand "Course content" outline on the course-detail page: sections with
// their lessons, each showing a status dot, type icon, title and duration. The
// current lesson is highlighted; locked (drip) lessons are non-interactive.

function typeIcon(kind: TrainingItem['content_kind']) {
  if (kind === 'video' || kind === 'live') return Play
  if (kind === 'google_doc' || kind === 'link') return ExternalLink
  if (kind === 'interactive') return Sparkles
  return FileText
}

function LessonRow({
  item,
  moduleId,
  current,
  locked,
}: {
  item: TrainingItem
  moduleId: string
  current: boolean
  locked: boolean
}) {
  const Icon = typeIcon(item.content_kind)
  const dot = item.completed ? (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#E7F7F1] text-[#158463]">
      <Check className="h-3 w-3" strokeWidth={3} />
    </span>
  ) : locked ? (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F0F2F8] text-[#8A91AB]">
      <Lock className="h-3 w-3" />
    </span>
  ) : current ? (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-blue text-white text-[10px]">▸</span>
  ) : (
    <span className="h-5 w-5 rounded-full border-2 border-brand-border" />
  )

  const inner = (
    <div
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 ${
        current ? 'bg-brand-soft' : locked ? 'opacity-60' : 'hover:bg-brand-canvas'
      }`}
      style={current ? { background: '#EAF0FE' } : undefined}
    >
      {dot}
      <Icon className="h-4 w-4 shrink-0 text-brand-muted-soft" />
      <span className={`min-w-0 flex-1 truncate text-sm ${current ? 'font-semibold text-brand-blue-dark' : 'text-brand-muted'}`}>
        {item.title}
      </span>
      {item.estimated_minutes ? (
        <span className="shrink-0 text-[11px] text-brand-muted-soft">{item.estimated_minutes} min</span>
      ) : null}
    </div>
  )

  return locked ? (
    <div aria-disabled>{inner}</div>
  ) : (
    <Link href={`/community/training/${moduleId}?lesson=${item.id}`} scroll={false} className="block">
      {inner}
    </Link>
  )
}

export function CourseOutline({
  moduleId,
  sections,
  ungrouped,
  currentId,
}: {
  moduleId: string
  sections: TrainingSection[]
  ungrouped: TrainingItem[]
  currentId: string
}) {
  return (
    <aside className="rounded-2xl border border-brand-border bg-white">
      <div className="border-b border-brand-hairline px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Course content</p>
      </div>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-3">
        {sections.map((s, i) => (
          <div key={s.id}>
            <div className="flex items-center justify-between px-3 pb-1">
              <p className="text-sm font-semibold text-brand-blue-dark">
                {i + 1}. {s.title}
              </p>
              {s.locked && <Lock className="h-3.5 w-3.5 text-brand-muted-soft" />}
            </div>
            <div className="space-y-0.5">
              {s.items.map((item) => (
                <LessonRow
                  key={item.id}
                  item={item}
                  moduleId={moduleId}
                  current={item.id === currentId}
                  locked={s.locked}
                />
              ))}
              {s.items.length === 0 && (
                <p className="px-3 py-2 text-xs text-brand-muted-soft">No lessons yet.</p>
              )}
            </div>
          </div>
        ))}
        {ungrouped.length > 0 && (
          <div>
            {sections.length > 0 && (
              <p className="px-3 pb-1 text-sm font-semibold text-brand-blue-dark">More lessons</p>
            )}
            <div className="space-y-0.5">
              {ungrouped.map((item) => (
                <LessonRow key={item.id} item={item} moduleId={moduleId} current={item.id === currentId} locked={false} />
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
