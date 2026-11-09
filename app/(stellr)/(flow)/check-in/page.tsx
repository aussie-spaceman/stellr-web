import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { loadOpenCheckIns, pickBannerEvent, todayUtc } from '@/lib/check-in-banner'
import { checkInNotOpen } from './not-open'

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

  return checkInNotOpen()
}
