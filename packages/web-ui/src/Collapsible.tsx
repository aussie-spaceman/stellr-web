'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from './primitives'

/**
 * A section that folds down to one summary line. Used wherever an admin page
 * stacks long panels or lists of registered groups, so the page can be read
 * as a list of headers and opened one piece at a time.
 *
 * - The header is a real button (aria-expanded / aria-controls) inside a
 *   heading, per the WAI accordion pattern. The whole row toggles.
 * - `summary` sits on the header line and stays visible while folded
 *   ("12 students · 3 unpaid"). `actions` show only while open, so a folded
 *   row is one line.
 * - Folded content stays mounted (`hidden`), so filters, half-typed forms and
 *   fetched data survive a fold.
 * - Inside a <CollapsibleGroup storageKey="…">, the open/closed state is
 *   remembered per browser under that key, and <CollapseAllControls> opens or
 *   folds every section in the group. Outside a group nothing is remembered.
 */

type Command = { open: boolean; seq: number }

interface GroupContext {
  storageKey: string
  command: Command | null
  setAll: (open: boolean) => void
}

const CollapsibleGroupContext = createContext<GroupContext | null>(null)

const STORAGE_PREFIX = 'stellr.collapse.'

function readStored(key: string): boolean | null {
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + key)
    return v === '1' ? true : v === '0' ? false : null
  } catch {
    return null
  }
}

function writeStored(key: string, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, open ? '1' : '0')
  } catch {
    // Private mode or storage blocked: the fold still works, it just isn't remembered.
  }
}

export function CollapsibleGroup({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const [command, setCommand] = useState<Command | null>(null)
  const setAll = useCallback((open: boolean) => setCommand((c) => ({ open, seq: (c?.seq ?? 0) + 1 })), [])
  return (
    <CollapsibleGroupContext.Provider value={{ storageKey, command, setAll }}>{children}</CollapsibleGroupContext.Provider>
  )
}

/** "Expand all · Collapse all" for the nearest <CollapsibleGroup>. */
export function CollapseAllControls({ className, label }: { className?: string; label?: string }) {
  const group = useContext(CollapsibleGroupContext)
  if (!group) return null
  const btn =
    'inline-flex min-h-9 items-center rounded-control px-2 text-sm font-medium text-primary-deep hover:bg-primary-soft focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary'
  return (
    <div className={cn('flex items-center gap-1', className)} role="group" aria-label={label ?? 'Expand or collapse sections'}>
      <button type="button" className={btn} onClick={() => group.setAll(true)}>
        Expand all
      </button>
      <span aria-hidden="true" className="text-content-muted">
        ·
      </span>
      <button type="button" className={btn} onClick={() => group.setAll(false)}>
        Collapse all
      </button>
    </div>
  )
}

export type CollapsibleTone = 'default' | 'primary' | 'muted'

const TONE: Record<CollapsibleTone, { box: string; header: string; title: string }> = {
  default: { box: 'border-line bg-white', header: 'hover:bg-surface', title: 'text-ink' },
  primary: { box: 'border-primary bg-white', header: 'bg-primary-soft hover:bg-primary-soft/70', title: 'text-primary-deep' },
  muted: { box: 'border-line bg-white', header: 'bg-surface hover:bg-line-light', title: 'text-content-body' },
}

export function Collapsible({
  id,
  title,
  summary,
  description,
  actions,
  defaultOpen = true,
  tone = 'default',
  headingLevel = 2,
  className,
  bodyClassName,
  children,
}: {
  /** Stable id: with the group's storageKey it names the remembered state. */
  id: string
  title: ReactNode
  /** Shown on the header line, open or folded. Keep it to one short line. */
  summary?: ReactNode
  /** Shown at the top of the body, only while open. */
  description?: ReactNode
  /** Buttons for the header's right edge, only while open. */
  actions?: ReactNode
  defaultOpen?: boolean
  tone?: CollapsibleTone
  headingLevel?: 2 | 3 | 4
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  const group = useContext(CollapsibleGroupContext)
  const key = group ? `${group.storageKey}:${id}` : null
  const [open, setOpenState] = useState(defaultOpen)
  const bodyId = useId()
  const seen = useRef<number | null>(null)

  // Remembered state is read after mount: the server can't see localStorage,
  // so the first paint uses defaultOpen and this corrects it.
  useEffect(() => {
    if (!key) return
    const stored = readStored(key)
    if (stored !== null) setOpenState(stored)
  }, [key])

  // Expand all / Collapse all.
  useEffect(() => {
    const cmd = group?.command
    if (!cmd || seen.current === cmd.seq) return
    seen.current = cmd.seq
    setOpenState(cmd.open)
    if (key) writeStored(key, cmd.open)
  }, [group?.command, key])

  const toggle = () => {
    setOpenState((o) => {
      if (key) writeStored(key, !o)
      return !o
    })
  }

  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  const t = TONE[tone]

  return (
    <section className={cn('overflow-hidden rounded-ds-card border', t.box, className)} data-open={open || undefined}>
      <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 pr-3 transition-colors', t.header)}>
        <Heading className="min-w-0 flex-1 basis-64">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
            className="flex min-h-11 w-full items-center gap-2 py-2 pl-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('h-4 w-4 shrink-0 text-content-muted transition-transform', open && 'rotate-90')}
            />
            <span className={cn('font-subheading text-sm font-semibold', t.title)}>{title}</span>
            {summary && <span className="min-w-0 truncate text-xs font-normal text-content-muted">{summary}</span>}
          </button>
        </Heading>
        {open && actions && <div className="flex flex-wrap items-center gap-3 py-1">{actions}</div>}
      </div>
      <div id={bodyId} hidden={!open} className={cn('border-t border-line-light', bodyClassName ?? 'p-4')}>
        {description && <div className="mb-3 text-xs text-content-muted">{description}</div>}
        {children}
      </div>
    </section>
  )
}
