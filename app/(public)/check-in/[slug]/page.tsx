import { notFound } from 'next/navigation'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import CheckInForm from '@/components/forms/CheckInForm'

export const metadata = { title: 'Event Check-In | Stellr Education' }
export const dynamic = 'force-dynamic'

// Public, token-gated check-in page reached by scanning the event QR code
// (in-person) or clicking the attendance link (virtual events).
export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ t?: string }>
}) {
  const [{ slug }, { t: token }] = await Promise.all([params, searchParams])

  const event = (await getEventBySlug(slug)) as (StellarEvent & { setting?: string }) | null
  if (!event) notFound()

  const isVirtual = event.setting === 'virtual'

  return (
    <div className="min-h-screen bg-gray-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
        <div className="text-center">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
            {isVirtual ? 'Confirm Your Attendance' : 'Event Check-In'}
          </p>
          <h1 className="text-xl font-bold text-gray-900 mt-1">{event.title}</h1>
          {event.date && <p className="text-sm text-gray-500 mt-0.5">{formatDate(event.date)}</p>}
        </div>
        {token ? (
          <CheckInForm slug={slug} token={token} isVirtual={isVirtual} />
        ) : (
          <p className="text-sm text-red-600 text-center">
            This check-in link is incomplete. Please re-scan the event QR code or use the link from your email.
          </p>
        )}
      </div>
    </div>
  )
}
