import Link from 'next/link'
import { CheckCircle, ExternalLink } from 'lucide-react'

interface PageProps {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ id?: string; type?: string; payment?: string; spreadsheet?: string }>
}

export default async function ConfirmationPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const { id, type, spreadsheet } = await searchParams
  const isGroup = type === 'group'
  const spreadsheetUrl = spreadsheet ? decodeURIComponent(spreadsheet) : null

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle size={64} className="text-green-500" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-brand-blue-dark mb-3">
          {isGroup ? 'Group Registration Submitted!' : 'Registration Submitted!'}
        </h1>

        <p className="text-gray-600 mb-6">
          {isGroup
            ? 'Thank you for registering your group. A confirmation email has been sent to you.'
            : 'Thank you for registering. A confirmation email will be sent once your payment is processed.'}
        </p>

        {id && (
          <div className="bg-gray-100 rounded-lg px-4 py-3 mb-6 text-sm text-gray-600">
            Reference ID: <span className="font-mono font-medium">{id}</span>
          </div>
        )}

        {/* Google Sheet link — spreadsheet path */}
        {spreadsheetUrl && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6 text-left">
            <p className="font-semibold text-brand-blue-dark mb-1">Your Team Member Spreadsheet</p>
            <p className="text-sm text-gray-600 mb-3">
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
            <p className="text-xs text-gray-400 mt-2">A link to this sheet has also been sent to your email.</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6 text-left space-y-3 mb-8">
          <p className="font-semibold text-brand-blue-dark">What happens next?</p>
          {isGroup ? (
            <ul className="space-y-2 text-sm text-gray-600">
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
            <ul className="space-y-2 text-sm text-gray-600">
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

        {/* Group participant sheet — available from the member portal.
            The sheet contains participant PII, so it's only accessible to the
            teacher / student manager who registered, after they sign in. */}
        {isGroup && !spreadsheetUrl && id && (
          <div className="mb-4">
            <Link
              href="/account?tab=teams"
              className="btn-outline w-full sm:w-auto inline-flex items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              Open Participant List as Google Sheet
            </Link>
            <p className="text-xs text-gray-400 mt-2">Sign in to your member account to open your group&apos;s Google Sheet with all registered participants pre-filled.</p>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={`/events/${slug}`} className="btn-outline">
            Back to Event
          </Link>
          <Link href="/events" className="btn-primary">
            Browse All Events
          </Link>
        </div>
      </div>
    </div>
  )
}
