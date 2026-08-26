'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

// The member-record view of Space access: every Space this person can enter and
// what puts them there. Read-only by design — suspend and revoke live on the
// Space's own Members tab, so there is one write surface rather than two views
// that could drift.

interface SpaceGrant {
  spaceId: string
  slug: string
  name: string
  accessType: 'open' | 'private' | 'secret'
  role: 'admin' | 'moderator' | 'member'
  status: 'active' | 'invited'
  reason: 'roster' | 'open' | 'tier' | 'role' | 'object' | 'invited'
  grantLabel: string | null
  postingSuspended: boolean
  revoked: boolean
}

const REASON_LABEL: Record<SpaceGrant['reason'], string> = {
  open: 'Open space',
  tier: 'Tier',
  role: 'Role',
  object: 'Object',
  invited: 'Invited',
  roster: 'Added directly',
}

export function MemberSpacesPanel({ memberId }: { memberId: string }) {
  const [spaces, setSpaces] = useState<SpaceGrant[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/members/${memberId}/spaces`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((j) => active && setSpaces(j.spaces ?? []))
      .catch(() => active && setFailed(true))
    return () => {
      active = false
    }
  }, [memberId])

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted-soft">
        Community spaces
      </h2>

      {failed ? (
        // Never render an empty list on failure — an admin would read it as
        // "this member has no space access" and act on it.
        <p className="text-xs text-red-600">Could not load space access. Reload to try again.</p>
      ) : !spaces ? (
        <p className="text-xs text-brand-muted-soft">Loading…</p>
      ) : spaces.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">This member cannot enter any space yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {spaces.map((s) => (
            <li key={s.spaceId} className="rounded-lg border border-brand-border px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`truncate text-sm ${s.revoked ? 'text-brand-muted-soft line-through' : 'text-brand-blue-dark'}`}>
                    {s.name}
                  </p>
                  <p className="truncate text-[11px] text-brand-muted-soft">
                    {REASON_LABEL[s.reason]}
                    {s.grantLabel && ` · ${s.grantLabel}`}
                  </p>
                </div>
                <Link
                  href={`/admin/community/spaces/${s.spaceId}`}
                  title="Manage this member in the space"
                  className="mt-0.5 shrink-0 text-brand-muted-soft hover:text-brand-blue"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {s.role !== 'member' && (
                  <span className="rounded-full bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase text-brand-muted">
                    {s.role === 'admin' ? 'Stellr Admin' : 'Moderator'}
                  </span>
                )}
                {s.status === 'invited' && (
                  <span className="rounded-full bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase text-brand-muted-soft">invited</span>
                )}
                {s.postingSuspended && (
                  <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase text-amber-700">suspended</span>
                )}
                {s.revoked && (
                  <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] uppercase text-red-600">revoked</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-[11px] text-brand-muted-soft">
        Suspend or revoke from the space&rsquo;s Members tab.
      </p>
    </div>
  )
}
