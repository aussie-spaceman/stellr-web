import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Users, User, Calendar, MapPin } from 'lucide-react'
import { getEventBySlug } from '@/lib/sanity'
import { formatDate, formatDateRange, registrationStatus } from '@/lib/utils'
import { getCurrentMember } from '@/lib/community'
import { RegistrationAuthBanner } from '@/components/registration/RegistrationAuthBanner'

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'
const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function RegisterTypePage({ params }: PageProps) {
  const { slug } = await params
  const event = await getEventBySlug(slug).catch(() => null)
  if (!event) notFound()

  const member = await getCurrentMember().catch(() => null)
  const returnUrl = `${WWW}/register/${slug}`
  const signInUrl = `${APP}/sign-in?redirect_url=${encodeURIComponent(returnUrl)}`

  const status = registrationStatus(event.registrationOpenDate, event.registrationCloseDate)

  if (status !== 'open') {
    const comingSoon = status === 'coming-soon'
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">{comingSoon ? '⏳' : '🔒'}</div>
          <h1 className="text-2xl font-bold text-brand-blue-dark mb-2">
            {comingSoon ? 'Registration Not Open Yet' : 'Registration Closed'}
          </h1>
          <p className="text-content-body mb-6">
            {comingSoon ? (
              <>
                Registration for <strong>{event.title}</strong>
                {event.registrationOpenDate
                  ? <> opens {formatDate(event.registrationOpenDate)}.</>
                  : <> hasn&apos;t opened yet.</>}
              </>
            ) : (
              <>Registration for <strong>{event.title}</strong> is no longer open.</>
            )}
          </p>
          <Link href="/events" className="btn-primary">
            Browse Other Events
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <div className="bg-brand-blue-dark text-white py-10 px-4">
        <div className="max-w-2xl mx-auto">
          <Link
            href={`/events/${slug}`}
            className="text-blue-300 text-sm hover:text-white transition-colors mb-4 inline-block"
          >
            ← Back to event
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">{event.title}</h1>
          {event.date && (
            <p className="text-blue-300 text-sm">
              📅 {formatDateRange(event.date, event.endDate)}
              {event.city && ` · 📍 ${event.city}${event.state ? `, ${event.state}` : ''}`}
            </p>
          )}
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-line">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="w-6 h-6 rounded-full bg-brand-blue text-white flex items-center justify-center text-xs font-bold">1</span>
            <span className="font-medium text-brand-blue-dark">Registration Type</span>
            <span className="text-content-faint mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-line-light text-content-faint flex items-center justify-center text-xs font-bold">2</span>
            <span className="text-content-faint">Your Details</span>
            <span className="text-content-faint mx-2">›</span>
            <span className="w-6 h-6 rounded-full bg-line-light text-content-faint flex items-center justify-center text-xs font-bold">3</span>
            <span className="text-content-faint">Confirmation</span>
          </div>
        </div>
      </div>

      {/* Type selector */}
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h2 className="text-xl font-bold text-brand-blue-dark mb-2">How are you registering?</h2>
        <p className="text-content-body mb-6">
          Individuals register and pay online. Teachers register a group and receive an invoice.
        </p>

        <div className="mb-8">
          <RegistrationAuthBanner
            signedIn={!!member}
            name={[member?.first_name, member?.last_name].filter(Boolean).join(' ') || undefined}
            email={member?.email ?? undefined}
            signInUrl={signInUrl}
            returnUrl={returnUrl}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href={`/register/${slug}/individual`}
            className="group bg-white rounded-xl border-2 border-line hover:border-brand-blue p-6 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center mb-4 transition-colors">
              <User size={22} className="text-brand-blue" />
            </div>
            <h3 className="font-bold text-brand-blue-dark text-lg mb-1">Individual</h3>
            <p className="text-sm text-content-body mb-4">
              I&apos;m registering myself (student or adult). I&apos;ll pay the registration fee online.
            </p>
            <span className="text-brand-blue text-sm font-medium group-hover:underline">
              Register as Individual →
            </span>
          </Link>

          <Link
            href={`/register/${slug}/group`}
            className="group bg-white rounded-xl border-2 border-line hover:border-brand-blue p-6 transition-all text-left"
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 group-hover:bg-blue-100 flex items-center justify-center mb-4 transition-colors">
              <Users size={22} className="text-brand-blue" />
            </div>
            <h3 className="font-bold text-brand-blue-dark text-lg mb-1">Group / Team</h3>
            <p className="text-sm text-content-body mb-4">
              I&apos;m a teacher, coach, or student manager registering a group. Choose your role in the next step.
            </p>
            <span className="text-brand-blue text-sm font-medium group-hover:underline">
              Register a Group →
            </span>
          </Link>
        </div>
      </div>
    </div>
  )
}
