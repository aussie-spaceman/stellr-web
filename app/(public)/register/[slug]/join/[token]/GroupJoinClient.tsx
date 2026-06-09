'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Props {
  token: string
  eventTitle: string
  eventSlug: string
  organiserName: string
  organiserRole: string
  schoolName: string
  memberPaysIndividually: boolean
}

export default function GroupJoinClient({
  token, eventTitle, eventSlug, organiserName, organiserRole, schoolName, memberPaysIndividually,
}: Props) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleJoin() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/register/group-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
        <div className="text-5xl">🎉</div>
        <h2 className="text-2xl font-bold text-brand-blue-dark">You&apos;re in!</h2>
        <p className="text-gray-600">
          You&apos;ve been registered for <strong>{eventTitle}</strong> as part of {organiserName}&apos;s group from {schoolName}.
        </p>
        {memberPaysIndividually && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">Payment required</p>
            <p className="mt-1">Check your email — we&apos;ve sent you a payment link to complete your registration.</p>
          </div>
        )}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link href="/account" className="btn-primary">View My Account →</Link>
          <Link href={`/events/${eventSlug}`} className="btn-outline">Event Details</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Join this group</h2>
          <p className="text-sm text-gray-500">Review the details below and confirm your participation</p>
        </div>

        <table className="w-full text-sm border-collapse">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-3 pr-4 font-medium text-gray-500 w-1/3">Event</td>
              <td className="py-3 font-medium text-gray-900">{eventTitle}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-3 pr-4 font-medium text-gray-500">School</td>
              <td className="py-3 text-gray-900">{schoolName}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-3 pr-4 font-medium text-gray-500">Organised by</td>
              <td className="py-3 text-gray-900">{organiserName} <span className="text-xs text-gray-400">({organiserRole})</span></td>
            </tr>
            <tr>
              <td className="py-3 pr-4 font-medium text-gray-500">Payment</td>
              <td className="py-3 text-gray-900">
                {memberPaysIndividually
                  ? 'You will pay individually — a payment link will be emailed to you'
                  : 'Group payment — handled by your organiser'}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-brand-blue-dark">
          Your Stellr member profile will be used for this registration. You can update your details in{' '}
          <Link href="/account" className="underline hover:no-underline">My Account</Link>.
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
            {error.toLowerCase().includes('profile') && (
              <p className="mt-2">
                <Link href="/account/onboarding" className="underline font-medium">
                  Complete your profile →
                </Link>{' '}
                then return to this link to join the group.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-3">
          <Link href={`/events/${eventSlug}`} className="btn-outline flex-1 text-center py-3">
            Cancel
          </Link>
          <button
            onClick={handleJoin}
            disabled={submitting}
            className="btn-primary flex-1 py-3 disabled:opacity-60"
          >
            {submitting ? 'Confirming…' : 'Confirm Registration →'}
          </button>
        </div>
      </div>
    </div>
  )
}
