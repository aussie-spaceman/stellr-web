'use client'

import { useEffect, useState } from 'react'
import { ParticipantForm } from './ParticipantForm'
import { EnvelopeStatusBadge } from './DocusignsSection'
import { displayEventRole } from '@/lib/member-enums'
import { Copy, Check } from 'lucide-react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }) }}
      className="inline-flex items-center gap-1 text-xs text-brand-blue hover:text-brand-blue-dark font-medium"
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
  emergency_contact_relationship: string | null
  join_completed_at: string | null
  member_id: string | null
  individual_payment_status: string | null
  event_companies?: { number: number; name: string | null } | null
}

interface DocuSignEnvelope {
  id: string
  status: string
  envelope_type: string
  signer_name: string
  signer_email: string
  sent_at: string
  completed_at: string | null
  reminder_sent_at: string | null
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
  // Declared group size (migration 037). Null on older registrations.
  adult_count: number | null
  student_count: number | null
  joinUrl: string | null
  // How the signed-in member relates to this group, for the role badge.
  viewerRole: 'teacher' | 'student_manager' | 'teacher_poc' | null
  participants: Participant[]
  docusignEnvelopes: Record<string, DocuSignEnvelope>
}

const VIEWER_ROLE_LABEL: Record<NonNullable<TeamRegistration['viewerRole']>, string> = {
  teacher: 'Teacher',
  student_manager: 'Student Manager',
  teacher_poc: 'Teacher POC',
}

function RoleBadge({ role }: { role: NonNullable<TeamRegistration['viewerRole']> }) {
  return (
    <span className="inline-flex text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
      {VIEWER_ROLE_LABEL[role]}
    </span>
  )
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
  readOnly = false,
}: {
  participations: StudentTeam[]
  onLeft: (participantId: string) => void
  readOnly?: boolean
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
    if (reg.invoice_requested) {
      // A settled invoice (paid, or auto-settled for $0/free events) confirms the
      // registration — show Paid rather than the perpetual "Invoice sent" pill.
      if (reg.status === 'confirmed') return { label: 'Invoice paid', style: 'bg-green-100 text-green-700' }
      return { label: 'Invoice sent to organiser', style: 'bg-blue-100 text-blue-700' }
    }
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
            {!readOnly && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-4 flex-wrap">
                {paymentPending && (
                  <button
                    onClick={() => handlePay(reg.id, entry.id)}
                    disabled={payingId === entry.id}
                    className="text-sm font-medium text-white bg-brand-blue hover:bg-blue-800 rounded-lg px-4 py-1.5 disabled:opacity-50"
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
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function participantIsMinor(dob: string): boolean {
  if (!dob) return false
  const d = new Date(dob)
  const eighteenth = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate())
  return new Date() < eighteenth
}


const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

const CONSENT_TYPE_LABEL: Record<string, string> = {
  minor:  'Parental consent',
  adult:  'Participation agreement',
  mentor: 'Mentor agreement',
}

// ── Teacher view ──────────────────────────────────────────────────────────────

function TeacherTeamsView({ memberQuery, readOnly }: { memberQuery: string; readOnly: boolean }) {
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
  const [resendingConsent, setResendingConsent] = useState<string | null>(null)
  const [consentMsg, setConsentMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/members/teams${memberQuery}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setTeams(data.teams ?? [])
        setParticipations(data.participations ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [memberQuery])

  async function loadTeam(id: string) {
    if (expanded === id) { setExpanded(null); setFullTeam(null); return }
    setExpanded(id)
    const res = await fetch(`/api/members/teams/${id}${memberQuery}`)
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
      const r2 = await fetch(`/api/members/teams/${registrationId}${memberQuery}`)
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
    const r = await fetch(`/api/members/teams/${registrationId}${memberQuery}`)
    const d = await r.json()
    if (!d.error) setFullTeam(d)
    setRemoving(null)
  }

  function handleParticipantSaved() {
    setAdding(false)
    setEditing(null)
    if (expanded) {
      fetch(`/api/members/teams/${expanded}${memberQuery}`)
        .then(r => r.json())
        .then(d => { if (!d.error) setFullTeam(d) })
    }
  }

  async function handleConsentResend(registrationId: string, participantId: string) {
    setResendingConsent(participantId)
    setConsentMsg(null)
    try {
      const res = await fetch(
        `/api/members/teams/${registrationId}/participants/${participantId}/docusign-resend`,
        { method: 'POST' },
      )
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Resend failed')
      setConsentMsg('Reminder sent.')
      const r = await fetch(`/api/members/teams/${registrationId}${memberQuery}`)
      const d = await r.json()
      if (!d.error) setFullTeam(d)
    } catch (e) {
      setConsentMsg(e instanceof Error ? e.message : 'Failed to resend')
    } finally {
      setResendingConsent(null)
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
        // Count by actual role — the old "everyone who isn't an adult is a
        // student" bucket mislabelled a lone teacher as "1 students".
        const total = team.participants.length
        // Declared size (migration 037) vs people actually entered → "Y remaining".
        const declaredTotal = team.adult_count != null && team.student_count != null
          ? team.adult_count + team.student_count
          : null
        const remaining = declaredTotal != null ? Math.max(0, declaredTotal - total) : 0
        const roleCounts: Record<string, number> = {}
        for (const p of team.participants) {
          const key = p.event_role === 'school_student_manager' ? 'teacher'
            : p.event_role === 'school_student' ? 'student'
            : p.event_role || 'participant'
          roleCounts[key] = (roleCounts[key] ?? 0) + 1
        }
        const ROLE_LABELS: Record<string, [string, string]> = {
          teacher: ['teacher', 'teachers'],
          student: ['student', 'students'],
          adult: ['adult', 'adults'],
          mentor: ['mentor', 'mentors'],
        }
        const roleBreakdown = Object.entries(roleCounts)
          .map(([role, n]) => {
            const labels = ROLE_LABELS[role] ?? [role, `${role}s`]
            return `${n} ${n === 1 ? labels[0] : labels[1]}`
          })
          .join(', ')
        const isOpen = expanded === team.id

        return (
          <div key={team.id} className="bg-white rounded-xl border border-gray-200">
            <button
              onClick={() => loadTeam(team.id)}
              className="w-full p-5 text-left flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-gray-900">{team.event_title}</p>
                  {team.viewerRole && <RoleBadge role={team.viewerRole} />}
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{team.school_name ?? '—'}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium">{total}</span>
                    {declaredTotal != null ? <span className="text-gray-400"> of {declaredTotal}</span> : null}
                    {' '}participant{(declaredTotal ?? total) === 1 ? '' : 's'}
                  </p>
                  {roleBreakdown && <p className="text-xs text-gray-400">{roleBreakdown}</p>}
                  {remaining > 0 && (
                    <p className="text-xs text-amber-600 font-medium" title="Declared group members who still need to be added via the completion link or Google Sheet.">
                      {remaining} still to add
                    </p>
                  )}
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
                        className="text-xs text-brand-blue hover:text-brand-blue-dark font-medium"
                      >
                        Share via email ↗
                      </a>
                    </div>
                  </div>
                )}

                {/* Sheet controls */}
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Every group registration has a related Google Sheet. When the
                      sheet ID is known we link straight to it; otherwise we hit the
                      on-demand endpoint which generates it, persists the ID, and
                      redirects (covers older registrations created before sheets
                      were generated up front). */}
                  {/* On-demand sheet generation is a write — in read-only view-as
                      only link out when a sheet already exists (direct Google link). */}
                  {(fullTeam.registration.spreadsheet_id || !readOnly) && (
                    <a
                      href={
                        fullTeam.registration.spreadsheet_id
                          ? `https://docs.google.com/spreadsheets/d/${fullTeam.registration.spreadsheet_id}/edit`
                          : `/api/registrations/${team.id}/spreadsheet`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-brand-blue hover:text-brand-blue-dark font-medium"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14H7v-2h5v2zm5-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
                      Open Sheet
                    </a>
                  )}
                  {!readOnly && fullTeam.registration.spreadsheet_id && (
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
                  {!readOnly && (
                    <button
                      onClick={() => setAdding(true)}
                      className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-white bg-brand-blue hover:bg-blue-800 rounded-lg px-3 py-1.5"
                    >
                      + Add participant
                    </button>
                  )}
                </div>

                {syncMsg && (
                  <p className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{syncMsg}</p>
                )}
                {consentMsg && (
                  <p className="text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-2">{consentMsg}</p>
                )}

                {/* Consent summary */}
                {(() => {
                  const minors = fullTeam.registration.participants.filter(p => participantIsMinor(p.date_of_birth))
                  if (minors.length === 0) return null
                  const envelopes = fullTeam.registration.docusignEnvelopes ?? {}
                  const signed   = minors.filter(p => envelopes[p.id]?.status === 'completed').length
                  const pending  = minors.filter(p => envelopes[p.id] && envelopes[p.id].status !== 'completed' && envelopes[p.id].status !== 'voided' && envelopes[p.id].status !== 'declined').length
                  const problem  = minors.filter(p => envelopes[p.id]?.status === 'declined' || envelopes[p.id]?.status === 'voided').length
                  const missing  = minors.filter(p => !envelopes[p.id]).length
                  const allDone  = signed === minors.length
                  return (
                    <div className={`rounded-lg px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1 ${allDone ? 'bg-green-50 border border-green-100' : 'bg-amber-50 border border-amber-100'}`}>
                      <span className={`font-medium ${allDone ? 'text-green-700' : 'text-amber-800'}`}>
                        Parental consent: {signed}/{minors.length} signed
                      </span>
                      {pending  > 0 && <span className="text-amber-700 text-xs self-center">{pending} awaiting</span>}
                      {problem  > 0 && <span className="text-red-600 text-xs self-center">{problem} declined/voided</span>}
                      {missing  > 0 && <span className="text-gray-500 text-xs self-center">{missing} not yet sent</span>}
                    </div>
                  )
                })()}

                {/* Agreement summary (adults & mentors) */}
                {(() => {
                  const envelopes = fullTeam.registration.docusignEnvelopes ?? {}
                  const adults = fullTeam.registration.participants.filter(
                    p => !participantIsMinor(p.date_of_birth) && envelopes[p.id],
                  )
                  if (adults.length === 0) return null
                  const signed  = adults.filter(p => envelopes[p.id]?.status === 'completed').length
                  const pending = adults.filter(p => { const s = envelopes[p.id]?.status; return s && s !== 'completed' && s !== 'voided' && s !== 'declined' }).length
                  const problem = adults.filter(p => { const s = envelopes[p.id]?.status; return s === 'declined' || s === 'voided' }).length
                  const allDone = signed === adults.length
                  return (
                    <div className={`rounded-lg px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1 ${allDone ? 'bg-green-50 border border-green-100' : 'bg-amber-50 border border-amber-100'}`}>
                      <span className={`font-medium ${allDone ? 'text-green-700' : 'text-amber-800'}`}>
                        Participation agreements: {signed}/{adults.length} signed
                      </span>
                      {pending > 0 && <span className="text-amber-700 text-xs self-center">{pending} awaiting</span>}
                      {problem > 0 && <span className="text-red-600 text-xs self-center">{problem} declined/voided</span>}
                    </div>
                  )
                })()}

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
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Company</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                          <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Consent / Agreement</th>
                          {fullTeam.registration.member_pays_individually && (
                            <th className="pb-2 font-medium text-gray-500 text-xs uppercase tracking-wide">Payment</th>
                          )}
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {fullTeam.registration.participants.map(p => {
                          const envelope = fullTeam.registration.docusignEnvelopes?.[p.id]
                          const isMinor = participantIsMinor(p.date_of_birth)
                          const canResend = envelope &&
                            envelope.status !== 'completed' &&
                            envelope.status !== 'voided' &&
                            (Date.now() - new Date(envelope.sent_at).getTime()) >= SEVEN_DAYS_MS

                          return (
                            <tr key={p.id} className="hover:bg-gray-50">
                              <td className="py-2.5 pr-4">{p.first_name} {p.last_name}</td>
                              <td className="py-2.5 pr-4 text-gray-500">{p.email}</td>
                              <td className="py-2.5 pr-4">{displayEventRole(p.event_role) ?? p.event_role}</td>
                              <td className="py-2.5 pr-4 text-gray-500">{p.grade ?? '—'}</td>
                              <td className="py-2.5 pr-4">
                                {p.event_companies ? (
                                  <span className="inline-flex text-xs px-2 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">
                                    {p.event_companies.name
                                      ? `${p.event_companies.number} — ${p.event_companies.name}`
                                      : `Company ${p.event_companies.number}`}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-2.5 pr-4">
                                {p.join_completed_at
                                  ? <span className="text-xs text-green-600 font-medium" title="Participant has confirmed their details.">Joined</span>
                                  : <span className="text-xs text-yellow-600 font-medium" title="Awaiting the participant to confirm via join link.">Pending</span>
                                }
                              </td>
                              <td className="py-2.5 pr-4">
                                {envelope ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <EnvelopeStatusBadge status={envelope.status} />
                                      {!readOnly && canResend && (
                                        <button
                                          onClick={() => handleConsentResend(team.id, p.id)}
                                          disabled={resendingConsent === p.id}
                                          className="text-xs text-brand-blue hover:text-brand-blue-dark font-medium disabled:opacity-50"
                                        >
                                          {resendingConsent === p.id ? 'Sending…' : 'Remind'}
                                        </button>
                                      )}
                                    </div>
                                    <p className="text-xs text-gray-400 leading-tight">
                                      {CONSENT_TYPE_LABEL[envelope.envelope_type] ?? 'Agreement'}
                                    </p>
                                    <p className="text-xs text-gray-400 leading-tight">
                                      {envelope.signer_name}
                                      {envelope.signer_email && <> &middot; {envelope.signer_email}</>}
                                    </p>
                                    <p className="text-xs text-gray-400">
                                      Sent {new Date(envelope.sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                                      {envelope.completed_at && <> &middot; Signed {new Date(envelope.completed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                                      {envelope.reminder_sent_at && !envelope.completed_at && <> &middot; Reminded {new Date(envelope.reminder_sent_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
                                    </p>
                                  </div>
                                ) : isMinor ? (
                                  <span className="text-xs text-gray-400">—</span>
                                ) : (
                                  <span className="text-xs text-gray-400">N/A</span>
                                )}
                              </td>
                              {fullTeam.registration.member_pays_individually && (
                                <td className="py-2.5 pr-4">
                                  <span
                                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                      p.individual_payment_status === 'paid'
                                        ? 'bg-green-100 text-green-700'
                                        : 'bg-amber-100 text-amber-700'
                                    }`}
                                  >
                                    {p.individual_payment_status === 'paid' ? 'Paid' : 'Not Yet Paid'}
                                  </span>
                                </td>
                              )}
                              <td className="py-2.5 text-right space-x-2">
                                {!readOnly && (
                                  <>
                                    <button
                                      onClick={() => setEditing(p)}
                                      className="text-xs text-brand-blue hover:text-brand-blue-dark font-medium"
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
                                  </>
                                )}
                              </td>
                            </tr>
                          )
                        })}
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
            nickname: (editing as { nickname?: string }).nickname ?? '',
            email: editing.email,
            phone: editing.phone ?? '',
            date_of_birth: editing.date_of_birth ?? '',
            gender: editing.gender ?? '',
            t_shirt_size: editing.t_shirt_size ?? '',
            grade: editing.grade ?? '',
            event_role: editing.event_role,
            ethnicity: (editing as { ethnicity?: string[] }).ethnicity ?? [],
            dietary_requirements: editing.dietary_requirements ?? [],
            health_conditions: editing.health_conditions ?? '',
            emergency_contact_first_name: editing.emergency_contact_first_name ?? '',
            emergency_contact_last_name: editing.emergency_contact_last_name ?? '',
            emergency_contact_email: editing.emergency_contact_email ?? '',
            emergency_contact_phone: editing.emergency_contact_phone ?? '',
            emergency_contact_relationship: editing.emergency_contact_relationship ?? '',
          }}
          onSaved={handleParticipantSaved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  )
}

// ── Student view ──────────────────────────────────────────────────────────────

function StudentTeamsView({
  memberId: _memberId,
  memberQuery,
  readOnly,
}: {
  memberId: string
  memberQuery: string
  readOnly: boolean
}) {
  const [teams, setTeams] = useState<StudentTeam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/members/teams${memberQuery}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setTeams(data.teams ?? [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [memberQuery])

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

  return <JoinedTeamsView participations={teams} readOnly={readOnly} onLeft={(pid) => setTeams(prev => prev.filter(t => t.id !== pid))} />
}

// ── Exports ───────────────────────────────────────────────────────────────────

interface Props {
  role: string
  memberId: string
  // Admin "view as member": fetch this member's teams (admin-gated server-side)
  // and render read-only — all mutating controls are hidden.
  impersonateMemberId?: string
  readOnly?: boolean
}

export function TeamsTab({ memberId, impersonateMemberId, readOnly = false }: Props) {
  const memberQuery = impersonateMemberId ? `?memberId=${impersonateMemberId}` : ''

  // Manager vs participant view is driven by what the member actually owns, not
  // by their members.event_role: a student manager's row is 'school_student' and
  // a teacher POC can be any role, yet both fully manage a group. The teams API
  // resolves ownership (registrant + nominated teacher POC) and reports which
  // view to render via `role`.
  const [apiRole, setApiRole] = useState<'group_manager' | 'student' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/members/teams${memberQuery}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (data.error) throw new Error(data.error)
        setApiRole(data.role === 'group_manager' ? 'group_manager' : 'student')
      })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [memberQuery])

  if (error) return <p className="text-sm text-red-600 py-4">{error}</p>
  if (apiRole === null) return <p className="text-sm text-gray-400 py-4">Loading your teams…</p>
  if (apiRole === 'group_manager')
    return <TeacherTeamsView memberQuery={memberQuery} readOnly={readOnly} />
  return <StudentTeamsView memberId={memberId} memberQuery={memberQuery} readOnly={readOnly} />
}
