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
    <div className="space-y-6">
      <div>
        <Link href={`/admin/competitions/${slug}`} className="text-sm text-brand-blue hover:text-brand-blue">
          ← {event.title}
        </Link>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark mt-1">Check-In — {event.title}</h1>
      </div>
      <CheckInLive eventSlug={slug} siteUrl={siteUrl} />
    </div>
  )
}
