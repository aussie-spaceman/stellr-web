'use client'

import { useEffect, useState } from 'react'
import { ParticipantForm } from './ParticipantForm'
import { Copy, Check } from 'lucide-react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Participant {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  t_shirt_size: string
  grade: string | null
  event_role: string
  dietary_requirements: string[]
  health_conditions: string | null
  emergency_contact_first_name: string | null
  emergency_contact_last_name: string | null
  emergency_contact_email: string | null
  emergency_contact_phone: string | null
  join_completed_at: string | null
  member_id: string | null
  individual_payment_status: string | null
}

interface TeamRegistration {
  id: string
  event_slug: string
  event_title: string
  school_name: string | null
  status: string
  created_at: string
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
  spreadsheet_id: string | null
  registrant_role: string | null
  teacher_poc_first_name: string | null
  teacher_poc_last_name: string | null
  teacher_poc_email: string | null
  member_pays_individually: boolean
  details_method: string | null
  joinUrl: string | null
  participants: Participant[]
}

interface StudentTeam {
  id: string
  event_role: string
  first_name: string
  last_name: string
  join_completed_at: string | null
  individual_payment_status: string | null
  registrations: {
    id: string
    event_slug: string
    event_title: string
    school_name: string | null
    status: string
    created_at: string
    teacher_first_name: string | null
    teacher_last_name: string | null
    teacher_email: string | null
    member_pays_individually?: boolean
    invoice_requested?: boolean
  }
}

// ── Joined teams view (shared between teacher + student paths) ────────────────

function JoinedTeamsView({
  participations,
  onLeft,
}: {
  participations: StudentTeam[]
  onLeft: (participantId: string) => void
}) {
  const [leaving, setLeaving] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState<string | null>(null)

  async function handleLeave(participantId: string, registrationId: string) {
    if (!confirm('Are you sure you want to leave this team? Your organiser will be notified.')) return
    setLeaving(participantId)
    await fetch(`/api/members/teams/${registrationId}/participants/${participantId}`, { method: 'DELETE' })
    onLeft(participantId)
    setLeaving(null)
  }

  async function handlePay(registrationId: string, participantId: string) {
    setPayingId(participantId)
    setPayError(null)
    try {
      const res = await fetch(`/api/members/teams/${registrationId}/payment-link`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not generate payment link')
      window.location.href = data.url
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Something went wrong')
      setPayingId(null)
    }
  }

  function paymentInfo(entry: StudentTeam, reg: StudentTeam['registrations']): { label: string; style: string } {
    if (reg.member_pays_individually) {
      if (entry.individual_payment_status === 'paid') return { label: 'Paid', style: 'bg-green-100 text-green-700' }
      if (entry.individual_payment_status === 'pending') return { label: 'Payment Required', style: 'bg-amber-100 text-amber-700' }
    }
    if (reg.invoice_requested) return { label: 'Invoice sent to organiser', style: 'bg-blue-100 text-blue-700' }
    return { label: 'Paid by group', style: 'bg-green-100 text-green-700' }
  }

  return (
    <div className="space-y-4">
      {payError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">{payError}</div>
      )}
      {participations.map(entry => {
        const reg = Array.isArray(entry.registrations) ? entry.registrations[0] : entry.registrations
        if (!reg) return null
        const { label, style } = paymentInfo(entry, reg)
        const paymentPending = reg.member_pays_individually && entry.individual_payment_status === 'pending'

        return (
          <div key={entry.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-medium text-gray-900">{reg.event_title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{reg.school_name ?? '—'}</p>
                {reg.teacher_first_name && (
                  <p className="text-sm text-gray-500 mt-0.5">
                    Organiser: {reg.teacher_first_name} {reg.teacher_last_name ?? ''}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                    reg.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                    reg.status === 'withdrawn' ? 'bg-red-100 text-red-600' :
                    'bg-yellow-100 text-yellow-700'
                  }`}
                  title={
                    reg.status === 'confirmed' ? 'Registration confirmed by Stellr — cleared to participate.' :
                    reg.status === 'withdrawn' ? 'Registration has been withdrawn and is no longer active.' :
                    'Registration received — awaiting Stellr confirmation.'
                  }
                >{reg.status}</span>
                <div className="mt-1.5">
                  <span
                    className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${style}`}
                    title={
                      label === 'Paid' ? 'Payment has been received for this registration.' :
                      label === 'Payment Required' ? 'Individual payment required — use the Pay Now button below to complete.' :
                      label === 'Invoice sent to organiser' ? 'An invoice has been raised and sent to the group organiser.' :
                      'Registration fee is covered by the group organiser — no individual payment needed.'
                    }
                  >
                    {label}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 flex-wrap">
              {paymentPending && (
                <button
                  onClick={() => handlePay(reg.id, entry.id)}
                  disabled={payingId === entry.id}
                  className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-1.5 disabled:opacity-50"
                >
                  {payingId === entry.id ? 'Redirecting…' : 'Pay Now →'}
                </button>
              )}
              <button
                onClick={() => handleLeave(entry.id, reg.id)}
                disabled={leaving === entry.id}
                className="text-sm text-red-500 hover:text-red-700 font-medium disabled:opacity-50 ml-auto"
              >
                {leaving === entry.id ? 'Leaving…' : 'Leave team'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Teacher view ──────────────────────────────────────────────────────────────

function TeacherTeamsView() {
  const [teams, setTeams] = useState<TeamRegistration[]>([])
  const [participations, setParticipations] = useState<StudentTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [fullTeam, setFullTeam] = useState<{ registration: TeamRegistration; watchActive: boolean } | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Participant | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/members/teams')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setTeams(data.teams ?? [])
        setParticipations(data.participations ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function loadTeam(id: string) {
    if (expanded === id) { setExpanded(null); setFullTeam(null); return }
    setExpanded(id)
    const res = await fetch(`/api/members/teams/${id}`)
    const data = await res.json()
    if (!data.error) setFullTeam(data)
  }

  async function handleSync(registrationId: string) {
    setSyncing(true)
    setSyncMsg(null)
    const res = await fetch(`/api/members/teams/${registrationId}/sheet-sync`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setSyncMsg(`Synced: ${data.updated} updated, ${data.created} added.${data.watchActive ? ' Live sync active.' : ''}`)
      // Reload full team
      const r2 = await fetch(`/api/members/teams/${registrationId}`)
      const d2 = await r2.json()
      if (!d2.error) setFullTeam(d2)
    } else {
      setSyncMsg(data.error ?? 'Sync failed')
    }
    setSyncing(false)
  }

  async function handleRemoveParticipant(registrationId: string, pid: string) {
    if (!confirm('Remove this participant from the team?')) return
    setRemoving(pid)
    await fetch(`/api/members/teams/${registrationId}/participants/${pid}`, { method: 'DELETE' })
    // Reload
    const r = await fetch(`/api/members/teams/${registrationId}`)
    const d = await r.json()
    if (!d.error) setFullTeam(d)
    setRemoving(null)
  }

  function handleParticipantSaved() {
    setAdding(false)
    setEditing(null)
    if (expanded) {
      fetch(`/api/members/teams/${expanded}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setFullTeam(d) })
    }
  }

  if (loading) return <p className="text-sm text-gray-400 py-4">Loading your teams…</p>
  if (error) return <p className="text-sm text-red-600 py-4">{error}</p>

  return (
    <div className="space-y-4">
      {teams.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <p className="text-gray-500 text-sm">You have no group registrations yet.</p>
        </div>
      )}

      {teams.map(team => {
        const adults = team.participants.filter(p => p.event_role === 'adult').length
        const students = team.participants.filter(p => p.event_role !== 'adult').length
        const isOpen = expanded === team.id

        return (
          <div key={team.id} className="bg-white rounded-xl border border-gray-200">
            <button
              onClick={() => loadTeam(team.id)}
              className="w-full p-5 text-left flex items-center justify-between"
            >
              <div>
                <p className="font-medium text-gray-900">{team.event_title}</p>
                <p className="text-sm text-gray-500 mt-0.5">{team.school_name ?? '—'}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">{students}</span> students
                    {adults > 0 && <>, <span className="font-medium">{adults}</span> adults</>}
                  </p>
                  <span
                    className={`inline-flex text-xs px-2 py-0.5 rounded-full mt-1 font-medium capitalize ${
                      team.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                      team.status === 'withdrawn' ? 'bg-red-100 text-red-600' :
                      'bg-yellow-100 text-yellow-700'
                    }`}
                    title={
                      team.status === 'confirmed' ? 'Registration confirmed by Stellr.' :
                      team.status === 'withdrawn' ? 'Registration has been withdrawn.' :
                      'Registration received — Stellr will confirm once reviewed.'
                    }
                  >{team.status}</span>
                </div>
                <svg className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {isOpen && fullTeam && fullTeam.registration.id === team.id && (
              <div className="border-t border-gray-100 p-5 space-y-4">
                {/* Teacher PoC (student manager registrations) */}
                {fullTeam.registration.registrant_role === 'student_manager' && fullTeam.registration.teacher_poc_email && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
                    <span className="font-medium">Teacher Point of Contact:</span>{' '}
                    {fullTeam.registration.teacher_poc_first_name} {fullTeam.registration.teacher_poc_last_name}{' '}
                    ({fullTeam.registration.teacher_poc_email}) — cc&apos;d on all correspondence
                  </div>
                )}

                {/* Join link for email_link registrations */}
                {fullTeam.registration.details_method === 'email_link' && fullTeam.registration.joinUrl && (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 space-y-2">
                    <p className="text-xs font-medium text-brand-blue-dark">Group Registration Link</p>
                    <p className="text-xs text-gray-500 break-all">{fullTeam.registration.joinUrl}</p>
                    <div className="flex gap-3">
                      <CopyButton text={fullTeam.registration.joinUrl} />
                      <a
                        href={`mailto:?subject=Join our group — ${fullTeam.registration.event_title}&body=Hi,%0A%0APlease use this link to complete your registration:%0A%0A${fullTeam.registration.joinUrl}%0A%0AThanks`}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
                      >
                        Share via email ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* Sheet controls */}
                <div className="flex items-center gap-3 flex-wrap">
                  {fullTeam.registration.spreadsheet_id && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${fullTeam.registration.spreadsheet_id}/edit`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                      Open Sheet
                    </a>
                  )}
                  {fullTeam.registration.spreadsheet_id && (
                    <button
                      onClick={() => handleSync(team.id)}
                      disabled={syncing}
                      className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                      <svg className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {syncing ? 'Syncing…' : 'Sync from Sheet'}
                    </button>
                  )}
                  {fullTeam.watchActive && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                      Live sync active
                    </span>
                  )}
                  <button
                    onClick={() => setAdding(true)}
                    className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5"
                  >
                    + Add participant
                  </button>
                </div>

                {syncMsg && (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{syncMsg}</p>
                )}

                {/* Participants table */}
                {fullTeam.registration.participants.length === 0 ? (
                  <p className="text-sm text-gray-500">No participants added yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left">
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Name</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Email</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Type</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Grade</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                          {fullTeam.registration.member_pays_individually && (
                            <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Payment</th>
                          )}
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {fullTeam.registration.participants.map(p => (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="py-2.5 pr-4">{p.first_name} {p.last_name}</td>
                            <td className="py-2.5 pr-4 text-gray-500">{p.email}</td>
                            <td className="py-2.5 pr-4 capitalize">{p.event_role}</td>
                            <td className="py-2.5 pr-4 text-gray-500">{p.grade ?? '—'}</td>
                            <td className="py-2.5 pr-4">
                              {p.join_completed_at
                                ? <span className="text-xs text-green-600 font-medium" title="This participant has completed the join link and confirmed their details.">Joined</span>
                                : <span className="text-xs text-yellow-600 font-medium" title="This participant hasn't completed the join link yet — they need to click the link sent to their email to confirm their details.">Pending</span>
                              }
                            </td>
                            {fullTeam.registration.member_pays_individually && (
                              <td className="py-2.5 pr-4">
                                <span
                                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    p.individual_payment_status === 'paid'
                                      ? 'bg-green-100 text-green-700'
                                      : 'bg-amber-100 text-amber-700'
                                  }`}
                                  title={
                                    p.individual_payment_status === 'paid'
                                      ? 'Payment has been received for this participant.'
                                      : 'Payment has not yet been received for this participant.'
                                  }
                                >
                                  {p.individual_payment_status === 'paid' ? 'Paid' : 'Not Yet Paid'}
                                </span>
                              </td>
                            )}
                            <td className="py-2.5 text-right space-x-2">
                              <button
                                onClick={() => setEditing(p)}
                                className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleRemoveParticipant(team.id, p.id)}
                                disabled={removing === p.id}
                                className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Teams joined as a participant */}
      {participations.length > 0 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Teams I&apos;ve Joined</h3>
          <JoinedTeamsView
            participations={participations}
            onLeft={(pid) => setParticipations(prev => prev.filter(p => p.id !== pid))}
          />
        </div>
      )}

      {/* Add / Edit modals */}
      {adding && expanded && (
        <ParticipantForm
          registrationId={expanded}
          onSaved={handleParticipantSaved}
          onCancel={() => setAdding(false)}
        />
      )}
      {editing && expanded && (
        <ParticipantForm
          registrationId={expanded}
          initial={{
            id: editing.id,
            first_name: editing.first_name,
            last_name: editing.last_name,
            email: editing.email,
            phone: editing.phone ?? '',
            date_of_birth: editing.date_of_birth ?? '',
            gender: editing.gender ?? '',
            t_shirt_size: editing.t_shirt_size ?? '',
            grade: editing.grade ?? '',
            event_role: editing.event_role,
            dietary_requirements: editing.dietary_requirements ?? [],
            health_conditions: editing.health_conditions ?? '',
            emergency_contact_first_name: editing.emergency_contact_first_name ?? '',
            emergency_contact_last_name: editing.emergency_contact_last_name ?? '',
            emergency_contact_email: editing.emergency_contact_email ?? '',
            emergency_contact_phone: editing.emergency_contact_phone ?? '',
          }}
          onSaved={handleParticipantSaved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ── Student view ──────────────────────────────────────────────────────────────

function StudentTeamsView({ memberId: _memberId }: { memberId: string }) {
  const [teams, setTeams] = useState<StudentTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/members/teams')
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setTeams(data.teams ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <p className="text-sm text-gray-400 py-4">Loading your teams…</p>
  if (error) return <p className="text-sm text-red-600 py-4">{error}</p>

  if (teams.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <p className="text-gray-500 text-sm">You haven&apos;t been added to any teams yet.</p>
        <p className="text-gray-400 text-xs mt-1">When a teacher registers a group event and adds you, it will appear here.</p>
      </div>
    )
  }

  return <JoinedTeamsView participations={teams} onLeft={(pid) => setTeams(prev => prev.filter(t => t.id !== pid))} />
}

// ── Exports ───────────────────────────────────────────────────────────────────

interface Props {
  role: string
  memberId: string
}

export function TeamsTab({ role, memberId }: Props) {
  if (role === 'teacher' || role === 'school_student_manager') return <TeacherTeamsView />
  return <StudentTeamsView memberId={memberId} />
}
