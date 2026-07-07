'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'
import { toast } from '@/components/ui/Toast'

// People tab — the Person 360 (design/admin-access). Pick a member, see their
// tier + role chips (bracket-gated: chips outside the member's bracket are
// greyed and unclickable, mirroring the server-side TIERS_BY_BRACKET /
// ROLES_BY_BRACKET guards) and the resolved Effective Access list with source
// badges and jump-to-object. Promotion of the old MemberAccessPanel.

interface AccessRow {
  objectType: string
  objectRef: string
  label: string
  role: string
  archived: boolean
  sources: { kind: string; label: string }[]
  redundant: boolean
}

interface PersonData {
  member: { id: string; first_name: string | null; last_name: string | null; email: string | null; age_bracket: string | null }
  bracket: string | null
  allowedTiers: string[] | null
  allowedRoles: string[] | null
  roles: string[]
  memberships: { membershipId: string; tierId: string; tierName: string | null; expiresAt: string | null }[]
  rows: AccessRow[]
}

const ALL_TIERS = ['Explorer', 'Pathfinder', 'Scholar', 'Alumni', 'Contributor', 'Counselor', 'Educator', 'Catalyst', 'Innovator', 'Trailblazer']
const ALL_ROLES = ['member', 'participant', 'student_manager', 'volunteer', 'mentor', 'coach', 'moderator', 'teacher', 'staff', 'donor_sponsor', 'parent']

const ROLE_LABELS: Record<string, string> = {
  member: 'Member', participant: 'Participant', student_manager: 'Student Manager',
  volunteer: 'Volunteer', mentor: 'Mentor', coach: 'Coach', moderator: 'Moderator',
  teacher: 'Teacher', staff: 'Staff', donor_sponsor: 'Donor / Sponsor', parent: 'Parent',
}

// Plain-language explanation of each "effective access" source badge.
const SOURCE_HINT: Record<string, string> = {
  Roster: 'Direct roster membership on this object (added to its people list)',
  'Rule (tier)': 'Granted automatically by a tier-based access rule',
  'Rule (role)': 'Granted automatically by a role-based access rule',
  Manager: 'Manages this object (coach / mentor / staff role)',
}

const TYPE_BADGE: Record<string, string> = {
  space: 'bg-purple-100 text-purple-800',
  course: 'bg-brand-blue/10 text-brand-blue',
  workshop: 'bg-teal-100 text-teal-800',
  cohort: 'bg-green-100 text-green-800',
  event: 'bg-amber-100 text-amber-800',
  campaign: 'bg-amber-100 text-amber-800',
  resource: 'bg-brand-hairline text-brand-muted',
}

export function PeopleTab({ onJumpToObject }: { onJumpToObject?: (ref: string) => void }) {
  const [person, setPerson] = useState<PersonData | null>(null)
  const [memberId, setMemberId] = useState<string | null>(null)
  const [tierBusy, setTierBusy] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    const res = await fetch(`/api/admin/access/people/${id}`)
    if (res.ok) setPerson(await res.json())
  }, [])

  useEffect(() => {
    if (memberId) void load(memberId)
  }, [memberId, load])

  const pick = (m: PickedMember) => setMemberId(m.id)

  const toggleTier = async (tierName: string) => {
    if (!person || !memberId) return
    const held = person.memberships.find((m) => m.tierName === tierName)
    setTierBusy(tierName)
    try {
      if (held) {
        const res = await fetch(`/api/admin/members/${memberId}/memberships/${held.membershipId}`, { method: 'DELETE' })
        if (!res.ok) toast('Could not remove tier', { tone: 'error' })
      } else {
        // Tier ids resolve server-side by name via the memberships route contract.
        const res = await fetch(`/api/admin/members/${memberId}/memberships`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tierName }),
        })
        if (!res.ok) toast((await res.json()).error ?? 'Could not grant tier', { tone: 'error' })
      }
      await load(memberId)
    } finally {
      setTierBusy(null)
    }
  }

  const toggleRole = async (role: string) => {
    if (!person || !memberId) return
    const held = person.roles.includes(role)
    const res = await fetch(`/api/admin/access/people/${memberId}`, {
      method: held ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not update role', { tone: 'error' })
    await load(memberId)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-brand-blue-dark">Find a member</h2>
        <MemberPicker onPick={pick} />
        {person && (
          <div className="mt-4 rounded-xl border border-brand-border bg-white p-4">
            <p className="font-medium text-brand-blue-dark">
              {person.member.first_name} {person.member.last_name}
            </p>
            <p className="text-xs text-brand-muted-soft">{person.member.email}</p>
            <p className="mt-1 text-xs text-brand-muted">
              Bracket: <span className="capitalize">{(person.bracket ?? 'unknown').replace('_', ' ')}</span>
            </p>
            <a
              href={`/admin/members/${person.member.id}`}
              className="mt-2 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
            >
              Full member record <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {!person ? (
          <p className="py-16 text-center text-sm text-brand-muted-soft">
            Search for a member to see their tier, roles and effective access.
          </p>
        ) : (
          <>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">Membership tier</h3>
              <div className="flex flex-wrap gap-1.5">
                {ALL_TIERS.map((t) => {
                  const held = person.memberships.some((m) => m.tierName === t)
                  // A held tier is always removable; the bracket only gates granting
                  // NEW tiers (so an out-of-bracket tier the member already has can
                  // still be taken off — previously it rendered as a stuck blue pill).
                  const allowed = held || !person.allowedTiers || person.allowedTiers.includes(t)
                  return (
                    <button
                      key={t}
                      onClick={() => allowed && toggleTier(t)}
                      disabled={!allowed || tierBusy === t}
                      title={allowed ? (held ? 'Click to remove' : 'Click to grant') : `Not available to ${(person.bracket ?? '').replace('_', ' ')} members`}
                      className={
                        'rounded-full border px-2.5 py-1 text-xs ' +
                        (held
                          ? 'border-brand-blue bg-brand-blue text-white'
                          : allowed
                            ? 'border-brand-border bg-white text-brand-muted hover:bg-brand-canvas'
                            : 'border-brand-hairline bg-brand-canvas text-brand-muted-soft/60 cursor-not-allowed line-through')
                      }
                    >
                      {t}
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">Web-app roles</h3>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ROLES.map((r) => {
                  const held = person.roles.includes(r)
                  // Held roles stay removable regardless of bracket (see tiers above).
                  const allowed = held || !person.allowedRoles || person.allowedRoles.includes(r)
                  return (
                    <button
                      key={r}
                      onClick={() => allowed && r !== 'member' && toggleRole(r)}
                      disabled={!allowed || r === 'member'}
                      title={allowed ? (r === 'member' ? 'Base role' : held ? 'Click to remove' : 'Click to grant') : `Not available to ${(person.bracket ?? '').replace('_', ' ')} members`}
                      className={
                        'rounded-full border px-2.5 py-1 text-xs ' +
                        (held
                          ? 'border-brand-teal bg-brand-teal text-white font-medium'
                          : allowed
                            ? 'border-brand-border bg-white text-brand-muted hover:bg-brand-canvas'
                            : 'border-brand-hairline bg-brand-canvas text-brand-muted-soft/60 cursor-not-allowed line-through')
                      }
                    >
                      {ROLE_LABELS[r] ?? r}
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">
                <ShieldCheck className="h-3.5 w-3.5" /> Effective access
              </h3>
              {person.rows.length === 0 ? (
                <p className="text-xs text-brand-muted-soft">No roster, rule or manager access yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {person.rows.map((row) => (
                    <li
                      key={`${row.objectType}:${row.objectRef}`}
                      className="flex items-center gap-2 rounded-lg border border-brand-hairline bg-white px-3 py-2 text-sm"
                    >
                      <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (TYPE_BADGE[row.objectType] ?? TYPE_BADGE.resource)}>
                        {row.objectType}
                      </span>
                      <span className="truncate text-brand-blue-dark">{row.label}</span>
                      {row.archived && <span className="text-[10px] uppercase text-brand-muted-soft">archived</span>}
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="text-xs text-brand-muted">{row.role}</span>
                        {row.sources.map((s, i) => (
                          <span
                            key={i}
                            title={SOURCE_HINT[s.label] ?? 'How this access is granted'}
                            className="rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] text-brand-muted"
                          >
                            {s.label}
                          </span>
                        ))}
                        {row.redundant && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800" title="On the roster and a manager of the same object">
                            redundant
                          </span>
                        )}
                        {onJumpToObject && (
                          <button onClick={() => onJumpToObject(row.objectRef)} className="text-brand-blue hover:underline text-xs">
                            open
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
