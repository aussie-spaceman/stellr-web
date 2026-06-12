'use client'

import { useState } from 'react'
import { useAuth } from '@clerk/nextjs'
import { useSignIn } from '@clerk/nextjs/legacy'
import Link from 'next/link'

interface Props {
  token: string
  eventTitle: string
  eventSlug: string
  organiserName: string
  organiserRole: string
  schoolName: string
  memberPaysIndividually: boolean
  isAuthenticated: boolean
}

const GENDERS = ['Male', 'Female', 'Other']
const T_SHIRT_SIZES = ['S', 'M', 'L', 'XL', '2XL', '3XL (or larger)']
const GRADES = ['9', '10', '11', '12', 'College Freshman', 'College Sophomore', 'College Junior', 'College Senior', 'Grad / PhD']
const DIETARY_OPTIONS = ['None', 'Dairy / Lactose Free', 'Gluten Free', 'Halal', 'Kosher', 'Vegetarian', 'Vegan', 'Other']
const ETHNICITIES = ['Pacific Islander', 'Hispanic', 'White (Caucasian)', 'Black', 'Native American', 'Asian', 'Prefer Not To Say']
const EMERGENCY_RELATIONSHIPS = ['Parent', 'Legal Guardian', 'Spouse', 'Grandparent', 'Teacher']

interface DetailsForm {
  type: 'Student' | 'Adult'
  first_name: string
  last_name: string
  nickname: string
  email: string
  phone: string
  date_of_birth: string
  gender: string
  t_shirt_size: string
  grade: string
  ethnicity: string[]
  dietary_requirements: string[]
  health_conditions: string
  emergency_contact_first_name: string
  emergency_contact_last_name: string
  emergency_contact_email: string
  emergency_contact_phone: string
  emergency_contact_relationship: string
}

const EMPTY_DETAILS: DetailsForm = {
  type: 'Student', first_name: '', last_name: '', nickname: '', email: '', phone: '',
  date_of_birth: '', gender: '', t_shirt_size: '', grade: '',
  ethnicity: [], dietary_requirements: [], health_conditions: '',
  emergency_contact_first_name: '', emergency_contact_last_name: '',
  emergency_contact_email: '', emergency_contact_phone: '', emergency_contact_relationship: '',
}

const inputClass = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue'

export default function GroupJoinClient({
  token, eventTitle, eventSlug, organiserName, organiserRole, schoolName, memberPaysIndividually, isAuthenticated,
}: Props) {
  const { isSignedIn } = useAuth()
  const { signIn, setActive, isLoaded: signInLoaded } = useSignIn()

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [form, setForm] = useState<DetailsForm>(EMPTY_DETAILS)

  const isStudent = form.type === 'Student'
  const isMinor = (() => {
    if (!form.date_of_birth) return isStudent
    const age = new Date().getFullYear() - new Date(form.date_of_birth).getFullYear()
    return Number.isFinite(age) && age < 18
  })()
  // Every student signs the minor participation agreement (regardless of age),
  // with their emergency contact as the guardian — so it's required for all
  // students, plus any non-student who happens to be under 18.
  const requiresEmergencyContact = isStudent || isMinor

  function set(field: keyof DetailsForm, value: string | string[]) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function toggleDietary(opt: string) {
    const cur = form.dietary_requirements
    set('dietary_requirements', cur.includes(opt) ? cur.filter(d => d !== opt) : [...cur, opt])
  }

  function toggleEthnicity(opt: string) {
    const cur = form.ethnicity
    set('ethnicity', cur.includes(opt) ? cur.filter(d => d !== opt) : [...cur, opt])
  }

  // Signed-in members: one-click join using their stored profile.
  async function handleJoinAuthenticated() {
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

  // New participants: submit details, then silently sign in with the returned
  // ticket so they land on their account without touching the sign-in widget.
  async function handleJoinNew(e: React.FormEvent) {
    e.preventDefault()
    if (requiresEmergencyContact && (
      !form.emergency_contact_first_name.trim() ||
      !form.emergency_contact_last_name.trim() ||
      !form.emergency_contact_email.trim() ||
      !form.emergency_contact_phone.trim() ||
      !form.emergency_contact_relationship.trim()
    )) {
      setError('Emergency contact details are required for students (and any participant under 18).')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/register/group-join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, details: form }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')

      if (data.signInToken && !isSignedIn && signInLoaded && signIn) {
        try {
          const result = await signIn.create({ strategy: 'ticket', ticket: data.signInToken })
          if (result.status === 'complete' && result.createdSessionId) {
            await setActive({ session: result.createdSessionId })
          }
        } catch (signInErr) {
          console.error('Auto sign-in failed (non-fatal):', signInErr)
        }
      }
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

  // ── Signed-in member: confirm with stored profile ──────────────────────────
  if (isAuthenticated) {
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
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
          )}

          <div className="flex gap-3">
            <Link href={`/events/${eventSlug}`} className="btn-outline flex-1 text-center py-3">Cancel</Link>
            <button onClick={handleJoinAuthenticated} disabled={submitting} className="btn-primary flex-1 py-3 disabled:opacity-60">
              {submitting ? 'Confirming…' : 'Confirm Registration →'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── New participant: collect details, provision + auto-login on submit ─────
  return (
    <form onSubmit={handleJoinNew} className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-8 space-y-6">
        <div>
          <h2 className="text-xl font-bold text-brand-blue-dark mb-1">Join {organiserName}&apos;s group</h2>
          <p className="text-sm text-gray-500">
            Registering for <strong>{eventTitle}</strong> · {schoolName}. Enter your details below — we&apos;ll create your
            Stellr account and sign you in automatically.
          </p>
        </div>

        {/* Type */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">I am joining as a</label>
          <div className="flex flex-wrap gap-4">
            {(['Student', 'Adult'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="type" checked={form.type === t} onChange={() => set('type', t)} />
                <span className="text-sm">{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Name */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First name <span className="text-red-500">*</span></label>
            <input required className={inputClass} value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last name <span className="text-red-500">*</span></label>
            <input required className={inputClass} value={form.last_name} onChange={e => set('last_name', e.target.value)} />
          </div>
        </div>

        {/* Preferred name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Preferred name / nickname</label>
          <input className={inputClass} value={form.nickname} onChange={e => set('nickname', e.target.value)} placeholder="Optional" />
        </div>

        {/* Contact */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
            <input required type="email" className={inputClass} value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input type="tel" className={inputClass} value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
        </div>

        {/* DOB / Gender */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date of birth <span className="text-red-500">*</span></label>
            <input required type="date" className={inputClass} value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
            <select className={inputClass} value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">Select…</option>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        {/* T-shirt / Grade */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">T-shirt size</label>
            <select className={inputClass} value={form.t_shirt_size} onChange={e => set('t_shirt_size', e.target.value)}>
              <option value="">Select…</option>
              {T_SHIRT_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {isStudent && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
              <select className={inputClass} value={form.grade} onChange={e => set('grade', e.target.value)}>
                <option value="">Select…</option>
                {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Ethnicity */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Ethnicity</label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {ETHNICITIES.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form.ethnicity.includes(opt)} onChange={() => toggleEthnicity(opt)} />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Dietary */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dietary requirements</label>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DIETARY_OPTIONS.map(opt => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={form.dietary_requirements.includes(opt)} onChange={() => toggleDietary(opt)} />
                <span className="text-sm">{opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Health */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Health conditions / allergies</label>
          <textarea className={inputClass} rows={2} value={form.health_conditions} onChange={e => set('health_conditions', e.target.value)} />
        </div>

        {/* Emergency contact */}
        <div className="border-t border-gray-100 pt-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">
            Emergency contact {requiresEmergencyContact && <span className="text-red-500">*</span>}
          </h3>
          <p className="text-xs text-gray-400 mb-3">Required for students and any participant under 18 — acts as the guardian for their participation agreement.</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">First name</label>
              <input className={inputClass} value={form.emergency_contact_first_name} onChange={e => set('emergency_contact_first_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Last name</label>
              <input className={inputClass} value={form.emergency_contact_last_name} onChange={e => set('emergency_contact_last_name', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input type="email" className={inputClass} value={form.emergency_contact_email} onChange={e => set('emergency_contact_email', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Phone</label>
              <input type="tel" className={inputClass} value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Relationship</label>
              <select className={inputClass} value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)}>
                <option value="">Select…</option>
                {EMERGENCY_RELATIONSHIPS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
        </div>

        {memberPaysIndividually && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            This group pays individually — a payment link will be emailed to you after you join.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-3">
          <Link href={`/events/${eventSlug}`} className="btn-outline flex-1 text-center py-3">Cancel</Link>
          <button type="submit" disabled={submitting} className="btn-primary flex-1 py-3 disabled:opacity-60">
            {submitting ? 'Joining…' : 'Join Group →'}
          </button>
        </div>
      </div>
    </form>
  )
}
