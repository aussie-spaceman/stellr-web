'use client'

import { useMemo, useRef, useState } from 'react'
import { Phone } from 'lucide-react'
import { Button, Dialog, cn } from '@stellr/web-ui'
import CheckInFlags from '@/components/admin/CheckInFlags'
import type { DeskContact, DeskFlags, GroupRow } from '@/lib/check-in-desk'

// Checking in a school group in one go (Oct 2026). The teacher arrives, the desk
// opens the group, everyone not yet here starts ticked, staff untick whoever
// isn't on the bus, and one tap checks in the rest. People already in (their
// own phone, another desk) show their time and aren't touched.

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function CheckInGroupSheet({
  row,
  flags,
  contact,
  onConfirm,
  onClose,
}: {
  row: GroupRow
  flags: Record<string, DeskFlags>
  contact: DeskContact | undefined
  onConfirm: (participantIds: string[]) => void
  onClose: () => void
}) {
  // The list as it was when the sheet opened: a phone check-in landing mid-way
  // must not untick or reorder anyone under the desk's finger.
  const [waiting] = useState(() => row.members.filter((m) => !m.checkedInAt))
  const waitingIds = useMemo(() => new Set(waiting.map((m) => m.id)), [waiting])
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(waitingIds))
  const confirmRef = useRef<HTMLButtonElement>(null)

  const toggle = (id: string) =>
    setTicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const count = waiting.filter((m) => ticked.has(m.id)).length
  const allTicked = count === waiting.length

  return (
    <Dialog
      open
      onClose={onClose}
      title={row.group.label}
      description={
        <>
          {row.group.teacher && <>{row.group.teacher} · </>}
          {row.arrived} of {row.total} here
          {contact?.phone && (
            <a
              href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}
              className="mt-1 flex min-h-9 items-center gap-1.5 font-medium text-primary-deep"
            >
              <Phone className="h-4 w-4" aria-hidden /> Call {contact.name?.split(' ')[0] ?? 'teacher'}: {contact.phone}
            </a>
          )}
        </>
      }
      initialFocusRef={confirmRef}
      bodyClassName="!px-0 !pb-0"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} className="min-h-12 px-4 py-2">
            Cancel
          </Button>
          <Button
            ref={confirmRef}
            onClick={() => onConfirm(waiting.filter((m) => ticked.has(m.id)).map((m) => m.id))}
            disabled={count === 0}
            className="min-h-12 px-5 py-2 text-base"
          >
            {waiting.length === 0 ? 'Everyone’s here' : `Check in ${count}`}
          </Button>
        </>
      }
    >
      {waiting.length > 0 && (
        <div className="flex items-center justify-between gap-3 px-5 text-sm sm:px-6">
          <p className="text-content-body">Untick anyone who isn’t here.</p>
          <button
            type="button"
            onClick={() => setTicked(allTicked ? new Set() : new Set(waitingIds))}
            className="min-h-11 shrink-0 px-2 font-medium text-primary-deep"
          >
            {allTicked ? 'Untick all' : 'Tick all'}
          </button>
        </div>
      )}
      <ul className="divide-y divide-line-light px-5 sm:px-6">
        {row.members.map((m) =>
          !waitingIds.has(m.id) ? (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-enviro-green-bg text-sm text-enviro-green-text"
                aria-hidden
              >
                ✓
              </span>
              <span className="min-w-0 flex-1 break-words text-base text-content-muted">
                {m.firstName} {m.lastName}
              </span>
              {m.checkedInAt && <span className="shrink-0 text-sm text-enviro-green-text">Here {timeLabel(m.checkedInAt)}</span>}
            </li>
          ) : (
            <li key={m.id} className="py-1">
              <label className="flex min-h-12 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={ticked.has(m.id)}
                  onChange={() => toggle(m.id)}
                  className="h-6 w-6 shrink-0 rounded border-line-strong accent-primary"
                />
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words text-base font-semibold',
                    ticked.has(m.id) ? 'text-ink' : 'text-content-muted line-through'
                  )}
                >
                  {m.firstName} {m.lastName}
                  {m.eventRole && m.eventRole !== 'participant' && (
                    <span className="ml-1.5 text-sm font-normal capitalize text-content-muted">{m.eventRole.replace(/_/g, ' ')}</span>
                  )}
                </span>
                {m.company && <span className="shrink-0 text-sm font-semibold tabular-nums text-content-body">Co. {m.company.number}</span>}
              </label>
              <CheckInFlags flags={flags[m.id]} className="-mt-2 mb-1 ml-9" />
            </li>
          )
        )}
      </ul>
    </Dialog>
  )
}
