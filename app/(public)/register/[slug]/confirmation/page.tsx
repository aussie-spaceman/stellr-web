import Link from 'next/link'
import { CheckCircle, ExternalLink } from 'lucide-react'
import { getEventBySlug } from '@/lib/sanity'
import { TrackEvent } from '@/components/analytics/TrackEvent'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ id?: string; type?: string; payment?: string; spreadsheet?: string; join?: string; remaining?: string; campaign?: string }>
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

export default async function ConfirmationPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { id, type, spreadsheet, join, remaining, campaign } = await searchParams
  const isGroup = type === 'group'
  const isCampaign = campaign === '1'
  const spreadsheetUrl = spreadsheet ? decodeURIComponent(spreadsheet) : null
  const joinUrl = join ? decodeURIComponent(join) : null
  // Some declared participants were left for later (partial "add them now").
  const remainingCount = remaining ? parseInt(remaining, 10) || 0 : 0
  const hasRemaining = isGroup && remainingCount > 0

  // Reaching this route is the trusted "registration succeeded" signal — the API
  // only redirects here after a successful submission. Fetch the title (non-PII)
  // for the event param; `id` is an opaque reference, never personal data.
  const event = await getEventBySlug(slug).catch(() => null)

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-16">
      <TrackEvent
        event={{
          event: 'registration_submitted',
          competition_name: event?.title,
          competition_id: slug,
          participation_type: isCampaign ? 'campaign' : 'event',
          ...(id ? { registration_ref: id } : {}),
        }}
      />
      <div className="max-w-lg w-full text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle size={64} className="text-green-500" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-brand-blue-dark mb-3">
          {isCampaign ? 'Campaign Registration Confirmed!' : isGroup ? 'Group Registration Submitted!' : 'Registration Submitted!'}
        </h1>

        <p className="text-content-body mb-6">
          {isCampaign
            ? 'Your group is registered — Campaigns are free. A confirmation email has been sent to you.'
            : isGroup
            ? 'Thank you for registering your group. A confirmation email has been sent to you.'
            : 'Thank you for registering. A confirmation email will be sent once your payment is processed.'}
        </p>

        {id && (
          <div className="bg-surface rounded-lg px-4 py-3 mb-6 text-sm text-content-body">
            Reference ID: <span className="font-mono font-medium">{id}</span>
          </div>
        )}

        {/* Partial add-now — remaining participants still need entering */}
        {hasRemaining && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6 text-left">
            <p className="font-semibold text-amber-900 mb-1">
              {remainingCount} more participant{remainingCount === 1 ? '' : 's'} still to add
            </p>
            <p className="text-sm text-amber-800 mb-3">
              You added everyone you had details for. Provide the remaining {remainingCount === 1 ? 'person' : `${remainingCount} people`} via your
              completion link, pre-filled Google Sheet, or Member Portal — whichever is easier.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              {spreadsheetUrl && (
                <a href={spreadsheetUrl} target="_blank" rel="noopener noreferrer" className="btn-primary inline-flex items-center justify-center gap-2 text-sm">
                  Open Google Sheet <ExternalLink size={14} />
                </a>
              )}
              {joinUrl && (
                <a href={joinUrl} target="_blank" rel="noopener noreferrer" className="btn-outline inline-flex items-center justify-center gap-2 text-sm">
                  Individual completion link <ExternalLink size={14} />
                </a>
              )}
              <Link href="/account?tab=teams" className="btn-outline inline-flex items-center justify-center gap-2 text-sm">
                Member Portal <ExternalLink size={14} />
              </Link>
            </div>
            <p className="text-xs text-amber-700 mt-2">These links have also been emailed to you.</p>
          </div>
        )}

        {/* Google Sheet link — spreadsheet path (whole roster provided later) */}
        {spreadsheetUrl && !hasRemaining && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6 text-left">
            <p className="font-semibold text-brand-blue-dark mb-1">Your Team Member Spreadsheet</p>
            <p className="text-sm text-content-body mb-3">
              A pre-formatted Google Sheet has been shared with your email. Fill in your team member details and return it to Stellr when complete.
            </p>
            <a
              href={spreadsheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2 text-sm"
            >
              Open Google Sheet
              <ExternalLink size={14} />
            </a>
            <p className="text-xs text-content-faint mt-2">A link to this sheet has also been sent to your email.</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-line p-6 text-left space-y-3 mb-8">
          <p className="font-semibold text-brand-blue-dark">What happens next?</p>
          {isCampaign ? (
            <ul className="space-y-2 text-sm text-content-body">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                Your registration is confirmed — Campaigns are free
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Your Campaign material is available now at the Stellr Portal
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                DocuSign agreements have been issued to every student registered in this Campaign — and your teacher agreement has just been issued
              </li>
            </ul>
          ) : isGroup ? (
            <ul className="space-y-2 text-sm text-content-body">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                Confirmation email sent to the teacher / coordinator
              </li>
              {spreadsheetUrl ? (
                <li className="flex items-start gap-2">
                  <span className="text-brand-blue mt-0.5">→</span>
                  Complete the team member spreadsheet and return it to Stellr
                </li>
              ) : (
                <li className="flex items-start gap-2">
                  <span className="text-brand-blue mt-0.5">→</span>
                  Invoice issued within 1–2 business days (if paying by invoice)
                </li>
              )}
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Registration confirmed upon payment receipt
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Participant agreements issued via DocuSign to each student, unless valid paperwork is already on record
              </li>
            </ul>
          ) : (
            <ul className="space-y-2 text-sm text-content-body">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                Payment processed
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                <span>
                  <span className="font-medium text-brand-blue-dark">Check your email to sign your DocuSign agreement</span> —
                  a parental consent form (sent to your parent/guardian for under-18s) or your participation
                  agreement. Your place isn&apos;t secured until it&apos;s signed.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Confirmation email with your Membership ID sent to your inbox
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Event details and schedule sent closer to the date
              </li>
            </ul>
          )}
        </div>

        {/* Campaign — jump straight to the campaign workspace in the member web app. */}
        {isCampaign && (
          <div className="mb-4">
            <a
              href={`${APP_URL}/events`}
              className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              Access Campaign →
            </a>
            <p className="text-xs text-content-faint mt-2">Open your Campaign in the Stellr Portal to access material and manage your team.</p>
          </div>
        )}

        {/* Group participant sheet — available from the member portal.
            The sheet contains participant PII, so it's only accessible to the
            teacher / student manager who registered, after they sign in. */}
        {!isCampaign && isGroup && !spreadsheetUrl && id && (
          <div className="mb-4">
            <Link
              href="/account?tab=teams"
              className="btn-outline w-full sm:w-auto inline-flex items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              Manage Your Team →
            </Link>
            <p className="text-xs text-content-faint mt-2">Open your team in the member portal to add participants, sync your Google Sheet, and track paperwork — all participant details stay private to you.</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={`/events/${slug}`} className="btn-outline">
            {isCampaign ? 'Back to Campaign' : 'Back to Event'}
          </Link>
          <Link href="/events" className="btn-primary">
            {isCampaign ? 'Browse Events & Campaigns' : 'Browse All Events'}
          </Link>
        </div>
      </div>
    </div>
  )
}
