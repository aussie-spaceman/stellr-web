import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { getEventBySlug, type StellarEvent } from '@/lib/sanity'
import { requireEventAccess } from '@/lib/event-access'
import { supabaseServer } from '@/lib/supabase'
import CheckInLive from '@/components/admin/CheckInLive'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

// Add to Home Screen on the desk iPad opens this event's desk full screen
// (app/api/check-in-desk/manifest), not the member app's home.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  return {
    title: 'Admin — Event Check-In',
    manifest: `/api/check-in-desk/manifest?slug=${encodeURIComponent(slug)}`,
    appleWebApp: { capable: true, title: 'Check-in', statusBarStyle: 'default' },
  }
}

export default async function EventCheckInPage({ params }: Params) {
  const { slug } = await params

  const access = await requireEventAccess(slug)
  if (!access.ok) redirect(access.status === 401 ? '/sign-in' : '/admin/competitions')

  // An event with registrations but no Sanity page (an archived or test event)
  // still gets a desk, named from its registrations.
  const event = (await getEventBySlug(slug)) as StellarEvent | null
  let title = event?.title ?? null
  if (!title) {
    const { data } = await supabaseServer().from('registrations').select('event_title').eq('event_slug', slug).limit(1).maybeSingle()
    title = (data?.event_title as string | null) ?? null
  }
  if (!title) notFound()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/admin/competitions/${slug}`}
          className="inline-flex min-h-11 items-center text-sm text-primary-deep hover:underline"
        >
          ← {title}
        </Link>
        <h1 className="font-display text-2xl font-bold text-ink">Check-in</h1>
      </div>
      <CheckInLive eventSlug={slug} eventTitle={title} siteUrl={siteUrl} isVirtual={event?.setting === 'virtual'} />
    </div>
  )
}
