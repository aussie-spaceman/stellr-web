'use client'

import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'

interface Participant {
  id: string
  first_name: string
  last_name: string
  email: string
  event_role: string
  individual_payment_status: string | null
  join_completed_at: string | null
}

interface Group {
  id: string
  event_slug: string
  event_title: string
  status: string
  created_at: string
  registrant_role: string
  teacher_poc_first_name: string | null
  teacher_poc_last_name: string | null
  teacher_poc_email: string | null
  member_pays_individually: boolean
  details_method: string
  invoice_requested: boolean
  participants: Participant[]
  joinUrl: string | null
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
      title="Copy link"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy link'}
    </button>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-800',
    confirmed: 'bg-green-100 text-green-800',
    withdrawn: 'bg-gray-100 text-gray-500',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  )
}

function paymentBadge(status: string | null) {
  if (!status) return null
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
    }`}>
      {status === 'paid' ? 'Paid' : 'Not Yet Paid'}
    </span>
  )
}

function GroupCard({ group }: { group: Group }) {
  const [open, setOpen] = useState(false)

  const registeredMembers = group.participants.filter(p => p.join_completed_at !== null || group.details_method !== 'email_link')
  const totalParticipants = group.participants.length

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between px-5 py-4 bg-white hover:bg-gray-50 text-left"
      >
        <div className="space-y-0.5">
          <p className="font-semibold text-gray-900 text-sm">{group.event_title}</p>
          <p className="text-xs text-gray-500">
            Registered {new Date(group.created_at).toLocaleDateString()}
            {' · '}
            {totalParticipants} participant{totalParticipants !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          {statusBadge(group.status)}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-5 py-4 space-y-4 bg-white">
          {/* Teacher PoC (student manager only) */}
          {group.registrant_role === 'student_manager' && group.teacher_poc_email && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800">
              <span className="font-medium">Teacher PoC:</span>{' '}
              {group.teacher_poc_first_name} {group.teacher_poc_last_name} ({group.teacher_poc_email}) — cc'd on all correspondence
            </div>
          )}

          {/* Payment info */}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-medium text-gray-700">Payment:</span>
            {group.member_pays_individually
              ? 'Group members pay individually'
              : group.invoice_requested
                ? 'Invoice issued to you'
                : 'Card payment at registration'}
          </div>

          {/* Join link for email_link registrations */}
          {group.details_method === 'email_link' && group.joinUrl && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 space-y-2">
              <p className="text-xs font-medium text-brand-blue-dark">Group Registration Link</p>
              <p className="text-xs text-gray-500 break-all">{group.joinUrl}</p>
              <div className="flex gap-3">
                <CopyButton text={group.joinUrl} />
                <a href={`mailto:?subject=Join our group — ${group.event_title}&body=Hi,%0A%0APlease use this link to complete your registration for ${group.event_title}:%0A%0A${group.joinUrl}%0A%0AThanks`}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  Share via email ↗
                </a>
              </div>
            </div>
          )}

          {/* Participants table */}
          <div>
            <p className="text-xs font-medium text-gray-700 mb-2">Group Members</p>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium text-gray-500">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-gray-500 hidden sm:table-cell">Role</th>
                    {group.details_method === 'email_link' && (
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Registered</th>
                    )}
                    {group.member_pays_individually && (
                      <th className="text-left px-3 py-2 font-medium text-gray-500">Payment</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {group.participants.map((p, i) => (
                    <tr key={p.id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{p.first_name} {p.last_name}</p>
                        <p className="text-gray-400">{p.email}</p>
                      </td>
                      <td className="px-3 py-2 text-gray-600 capitalize hidden sm:table-cell">
                        {p.event_role.replace(/_/g, ' ')}
                      </td>
                      {group.details_method === 'email_link' && (
                        <td className="px-3 py-2">
                          {p.join_completed_at ? (
                            <span className="text-green-700 font-medium">✓ Done</span>
                          ) : (
                            <span className="text-amber-600">Pending</span>
                          )}
                        </td>
                      )}
                      {group.member_pays_individually && (
                        <td className="px-3 py-2">
                          {paymentBadge(p.individual_payment_status)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {group.details_method === 'email_link' && (
              <p className="text-xs text-gray-400 mt-2">
                {registeredMembers.length} of {totalParticipants} members have completed registration
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function GroupTeamPanel() {
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/members/my-groups')
      .then(r => r.json())
      .then(d => { setGroups(d.groups ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-sm text-gray-400">Loading group registrations…</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-2">My Groups</h2>
        <p className="text-sm text-gray-500">You haven&apos;t registered any groups yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">My Groups</h2>
      <div className="space-y-3">
        {groups.map(group => (
          <GroupCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  )
}
