import { auth, currentUser } from '@clerk/nextjs/server'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import GroupJoinClient from './GroupJoinClient'

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export default async function GroupJoinPage({ params }: PageProps) {
  const { slug, token } = await params

  // Brand-new participants don't need an account up front — they fill their
  // details on this page and are auto-provisioned + signed in on submit (the
  // hosted Clerk sign-in widget is timeout-prone and blocks first-timers).
  // Signed-in members still get the one-click confirm path below.
  const { userId } = await auth()

  // Validate the token
  const db = supabaseServer()
  const { data: tokenRow, error } = await db
    .from('group_join_tokens')
    .select('*, registrations(teacher_first_name, teacher_last_name, school_name, registrant_role, status, member_pays_individually, adult_count, student_count)')
    .eq('token', token)
    .eq('event_slug', slug)
    .maybeSingle()

  if (error || !tokenRow) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">🔗</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h1>
          <p className="text-gray-600 mb-6">This registration link is not valid. Please check with your group organiser.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">⏰</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Expired</h1>
          <p className="text-gray-600 mb-6">This registration link expired on {formatDateShort(tokenRow.expires_at)}. Please contact your group organiser for a new link.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  const reg = tokenRow.registrations as {
    teacher_first_name: string; teacher_last_name: string
    school_name: string; registrant_role: string; status: string
    member_pays_individually: boolean
    adult_count: number | null; student_count: number | null
  }

  // Check if already registered
  const clerkUser = await currentUser()
  const memberEmail = clerkUser?.emailAddresses?.[0]?.emailAddress ?? ''

  let alreadyRegistered = false
  if (memberEmail) {
    const { data: existing } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', tokenRow.registration_id)
      .eq('email', memberEmail)
      .maybeSingle()
    alreadyRegistered = !!existing
  }

  // Is every declared place already filled? Mirrors the cap enforced in the
  // group-join route so a forwarded link shows a clear "full" message rather than
  // a form that will be rejected. Older registrations (null counts) are never full.
  let groupFull = false
  if (!alreadyRegistered && reg.adult_count != null && reg.student_count != null) {
    const { count } = await db
      .from('participants')
      .select('*', { count: 'exact', head: true })
      .eq('registration_id', tokenRow.registration_id)
    groupFull = (count ?? 0) >= reg.adult_count + reg.student_count
  }

  const organiserName = `${reg.teacher_first_name} ${reg.teacher_last_name}`
  const organiserRole = reg.registrant_role === 'student_manager' ? 'Student Manager' : 'Teacher'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{tokenRow.event_title}</h1>
          <p className="text-blue-300 text-sm">Group Registration — {reg.school_name}</p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-10">
        {alreadyRegistered ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
            <div className="text-4xl">✅</div>
            <h2 className="text-xl font-bold text-gray-900">You&apos;re already registered!</h2>
            <p className="text-gray-600">You&apos;ve already joined this group for <strong>{tokenRow.event_title}</strong>.</p>
            <Link href="/account" className="btn-primary inline-block mt-4">View My Account →</Link>
          </div>
        ) : groupFull ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center space-y-4">
            <div className="text-4xl">🎟️</div>
            <h2 className="text-xl font-bold text-gray-900">This group is full</h2>
            <p className="text-gray-600">
              Every place {organiserName} registered for <strong>{tokenRow.event_title}</strong> has been filled.
              Please contact your group organiser if you think this is a mistake.
            </p>
            <Link href={`/events/${slug}`} className="btn-primary inline-block mt-4">View Event →</Link>
          </div>
        ) : (
          <GroupJoinClient
            token={token}
            eventTitle={tokenRow.event_title}
            eventSlug={slug}
            organiserName={organiserName}
            organiserRole={organiserRole}
            schoolName={reg.school_name}
            memberPaysIndividually={reg.member_pays_individually}
            isAuthenticated={!!userId}
          />
        )}
      </div>
    </div>
  )
}
