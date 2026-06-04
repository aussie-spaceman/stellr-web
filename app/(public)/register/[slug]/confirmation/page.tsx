import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

interface PageProps {
  params: { slug: string }
  searchParams: { id?: string; type?: string }
}

export default function ConfirmationPage({ params, searchParams }: PageProps) {
  const isGroup = searchParams.type === 'group'

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
            ? 'Thank you for registering your group. A confirmation email has been sent to you, and an invoice will follow within 1–2 business days. Your registration will be confirmed upon receipt of payment.'
            : 'Thank you for registering. A confirmation email has been sent to your inbox. Your spot is pending — we\'ll confirm once we\'ve reviewed your entry.'}
        </p>

        {searchParams.id && (
          <div className="bg-gray-100 rounded-lg px-4 py-3 mb-6 text-sm text-gray-600">
            Reference ID: <span className="font-mono font-medium">{searchParams.id}</span>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 p-6 text-left space-y-3 mb-8">
          <p className="font-semibold text-brand-blue-dark">What happens next?</p>
          {isGroup ? (
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                Confirmation email sent to the teacher/coordinator
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Invoice issued within 1–2 business days
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Registration confirmed upon payment receipt
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Parental permission forms will be sent via DocuSign to each student
              </li>
            </ul>
          ) : (
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">✓</span>
                Confirmation email sent to you
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Registration reviewed and confirmed by Stellr
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Payment processed upon confirmation
              </li>
              <li className="flex items-start gap-2">
                <span className="text-brand-blue mt-0.5">→</span>
                Event details and schedule sent closer to the date
              </li>
            </ul>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href={`/events/${params.slug}`} className="btn-outline">
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
