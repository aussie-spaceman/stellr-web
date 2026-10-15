import { redirect } from 'next/navigation'
import { Eyebrow } from '@stellr/web-ui'
import { supabaseServer } from '@/lib/supabase'
import { loadOpenCheckIns, pickBannerEvent, todayUtc } from '@/lib/check-in-banner'

export const metadata = { title: 'Event Check-In', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// The address on the check-in banner (Oct 2026). One banner travels to every
// event, so its QR code can't name one: this page sends the phone on to the
// in-person event whose check-in is open (lib/check-in-banner.ts), where the
// participant enters their name and date of birth.
//
// redirect() answers 307, which is temporary on purpose. A phone caches a
// permanent (308) redirect and would go back to last month's event.
export default async function CheckInBannerPage() {
  const target = pickBannerEvent(await loadOpenCheckIns(supabaseServer()), todayUtc())
  if (target?.token) redirect(`/check-in/${target.slug}?t=${encodeURIComponent(target.token)}`)

  return (
    <div className="flex items-start justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md space-y-3 rounded-ds-card border border-line bg-white p-6 text-center shadow-sm">
        <Eyebrow>Event check-in</Eyebrow>
        <h1 className="font-display text-xl font-bold text-ink">Check-in isn’t open yet</h1>
        <p className="text-content-body">
          Head to the registration desk and we’ll check you in, or scan the code again in a few minutes.
        </p>
      </div>
    </div>
  )
}
