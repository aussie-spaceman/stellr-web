import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { supabaseServer } from '@/lib/supabase'
import GroupJoinClient from './GroupJoinClient'

interface PageProps {
  params: Promise<{ slug: string; token: string }>
}

export default async function GroupJoinPage({ params }: PageProps) {
  const { slug, token } = await params

  // If not signed in, redirect to sign-in with return URL
  const { userId } = await auth()
  if (!userId) {
    const returnUrl = `/register/${slug}/join/${token}`
    redirect(`/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`)
  }

  // Validate the token
  const db = supabaseServer()
  const { data: tokenRow, error } = await db
    .from('group_join_tokens')
    .select('*, registrations(teacher_first_name, teacher_last_name, school_name, registrant_role, status, member_pays_individually)')
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
          <p className="text-gray-600 mb-6">This registration link expired on {new Date(tokenRow.expires_at).toLocaleDateString()}. Please contact your group organiser for a new link.</p>
          <Link href="/events" className="btn-primary">Browse Events</Link>
        </div>
      </div>
    )
  }

  const reg = tokenRow.registrations as {
    teacher_first_name: string; teacher_last_name: string
    school_name: string; registrant_role: string; status: string
    member_pays_individually: boolean
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
        ) : (
          <GroupJoinClient
            token={token}
            eventTitle={tokenRow.event_title}
            eventSlug={slug}
            organiserName={organiserName}
            organiserRole={organiserRole}
            schoolName={reg.school_name}
            memberPaysIndividually={reg.member_pays_individually}
          />
        )}
      </div>
    </div>
  )
}
