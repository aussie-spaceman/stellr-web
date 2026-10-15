import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { requireEventAccess } from '@/lib/event-access'
import CheckInLive from '@/components/admin/CheckInLive'

export const metadata = { title: 'Admin — Event Check-In' }
export const dynamic = 'force-dynamic'

export default async function EventCheckInPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const access = await requireEventAccess(slug)
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin/competitions')

  const event = (await getEventBySlug(slug)) as StellarEvent | null
  if (!event) notFound()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/admin/competitions/${slug}`}
          className="inline-flex min-h-11 items-center text-sm text-primary-deep hover:underline"
        >
          ← {event.title}
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Check-in</h1>
      </div>
      <CheckInLive eventSlug={slug} eventTitle={event.title} siteUrl={siteUrl} isVirtual={event.setting === 'virtual'} />
    </div>
  )
}
