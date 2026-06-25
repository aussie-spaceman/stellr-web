'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Link2, Search } from 'lucide-react'
import { ResourceAccessSelect } from '@/components/community/resources/AttachedResourceList'

export interface AttachedFileResource {
  resourceId: string
  title: string
  fileType: string | null
  isMandatory: boolean
  dueAt: string | null
  minMembership: number | null
}

// Attach standalone files/links from the community resource library to a cohort
// (the unified Resources tab: courses + recordings + these). Mentor/admin only —
// posts to /api/community/mentoring/manage (gated server-side).
export function CohortResourceAttacher({
  cohortId,
  attached,
  tz,
  endpoint = '/api/community/mentoring/manage',
}: {
  cohortId: string
  attached: AttachedFileResource[]
  tz: string
  /** Manage API endpoint; coaching workshops pass their own. */
  endpoint?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; title: string; fileType: string | null }[]>([])
  const [searching, setSearching] = useState(false)

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cohortId, ...payload }),
    })
    if (res.ok) router.refresh()
    return res.ok
  }

  const search = async (term: string) => {
    setQ(term)
    setSearching(true)
    try {
      const res = await fetch(`${endpoint}?cohortId=${cohortId}&q=${encodeURIComponent(term)}`)
      if (res.ok) setResults((await res.json()).results ?? [])
    } finally {
      setSearching(false)
    }
  }

  const attachedIds = new Set(attached.map((a) => a.resourceId))

  return (
    <div className="mt-4 rounded-card border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Files &amp; links</h2>
        <button
          onClick={() => { setOpen((v) => !v); if (!open) search('') }}
          className="rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15"
        >
          Attach a resource
        </button>
      </div>

      {open && (
        <div className="mb-4 rounded-[12px] bg-surface p-3">
          <div className="flex items-center gap-2 rounded-[9px] border border-line bg-white px-3 py-2">
            <Search className="h-4 w-4 text-content-faint" />
            <input
              value={q}
              onChange={(e) => search(e.target.value)}
              placeholder="Search the resource library…"
              className="flex-1 text-sm outline-none"
            />
          </div>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {searching && <li className="px-2 py-2 text-[13px] text-content-muted">Searching…</li>}
            {!searching && results.length === 0 && <li className="px-2 py-2 text-[13px] text-content-muted">No resources found.</li>}
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 hover:bg-white">
                <span className="flex items-center gap-2 text-sm text-content-body">
                  <FileText className="h-4 w-4 text-content-faint" /> {r.title}
                </span>
                {attachedIds.has(r.id) ? (
                  <span className="text-[12px] text-content-faint">Attached</span>
                ) : (
                  <button onClick={() => post({ action: 'attachResource', resourceId: r.id, mandatory: false })} className="rounded-[8px] bg-space-violet px-3 py-1 text-[12.5px] font-semibold text-white">
                    Attach
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {attached.length === 0 ? (
        <p className="text-sm text-content-muted">No files or links attached.</p>
      ) : (
        <ul className="divide-y divide-line-light">
          {attached.map((r) => (
            <AttachedRow key={r.resourceId} cohortId={cohortId} r={r} tz={tz} post={post} />
          ))}
        </ul>
      )}
    </div>
  )
}

function AttachedRow({
  cohortId,
  r,
  tz,
  post,
}: {
  cohortId: string
  r: AttachedFileResource
  tz: string
  post: (p: Record<string, unknown>) => Promise<boolean>
}) {
  const router = useRouter()
  const [mandatory, setMandatory] = useState(r.isMandatory)
  const [due, setDue] = useState(r.dueAt ? r.dueAt.slice(0, 10) : '')
  const isLink = (r.fileType ?? '').toLowerCase() === 'link' || (r.fileType ?? '').toLowerCase() === 'url'

  const save = (m: boolean, d: string) =>
    post({ action: 'attachResource', resourceId: r.resourceId, mandatory: m, dueAt: d ? new Date(d).toISOString() : null })

  // Per-attachment access floor posts to /contribute (the container-management
  // endpoint), not the mentoring manage API.
  const setAccess = async (v: 'all' | 'paid') => {
    const res = await fetch('/api/community/resources/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        containerId: cohortId,
        action: 'setAccess',
        binaryId: r.resourceId,
        minMembership: v === 'paid' ? 1 : null,
      }),
    })
    if (res.ok) router.refresh()
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex items-center gap-2 font-medium text-ink">
        {isLink ? <Link2 className="h-4 w-4 text-enviro-green" /> : <FileText className="h-4 w-4 text-primary" />}
        {r.title}
      </span>
      <div className="flex items-center gap-3">
        <ResourceAccessSelect value={(r.minMembership ?? 0) > 0 ? 'paid' : 'all'} onChange={setAccess} />
        <label className="flex items-center gap-1.5 text-[13px] text-content-secondary">
          <input type="checkbox" checked={mandatory} onChange={(e) => { setMandatory(e.target.checked); save(e.target.checked, due) }} className="h-4 w-4 accent-space-violet" />
          Mandatory
        </label>
        {mandatory && (
          <input type="date" value={due} onChange={(e) => { setDue(e.target.value); save(mandatory, e.target.value) }} className="rounded-[9px] border border-line px-2.5 py-1.5 text-[13px] text-content" />
        )}
        {!mandatory && due && <span className="text-[12px] text-content-faint">due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(due))}</span>}
        <button onClick={() => post({ action: 'detachResource', resourceId: r.resourceId })} className="text-[13px] font-medium text-danger hover:underline">Remove</button>
      </div>
    </li>
  )
}
