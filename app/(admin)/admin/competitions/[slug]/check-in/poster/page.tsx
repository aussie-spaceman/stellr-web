import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import CheckInPoster from '@/components/admin/CheckInPoster'

export const metadata = { title: 'Admin — Check-In Door Poster' }
export const dynamic = 'force-dynamic'

export default async function CheckInPosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const access = await requireEventAccess(slug)
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin/competitions')

  const event = (await getEventBySlug(slug)) as StellarEvent | null
  if (!event) notFound()

  const { data: settings } = await supabaseServer()
    .from('event_settings')
    .select('check_in_token')
    .eq('event_slug', slug)
    .maybeSingle()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const url = settings?.check_in_token ? `${siteUrl}/check-in/${slug}?t=${settings.check_in_token}` : null

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href={`/admin/competitions/${slug}/check-in`} className="text-sm text-primary">
          ← Check-in
        </Link>
        <h1 className="mt-1 font-heading text-title uppercase text-ink">Door poster — {event.title}</h1>
      </div>
      {url ? (
        <CheckInPoster url={url} title={event.title} dateLabel={event.date ? formatDate(event.date) : null} />
      ) : (
        <p className="text-sm text-content-muted">Open check-in first to create the event’s QR code.</p>
      )}
    </div>
  )
}
