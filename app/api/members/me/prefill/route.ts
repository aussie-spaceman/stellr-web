import { NextResponse } from 'next/server'
import { getRegistrationPrefill } from '@/lib/registration-prefill'

/**
 * The signed-in member's own contact details, for pre-filling public lead forms.
 *
 * Why an endpoint rather than a server prop: these forms are scattered — the
 * subscribe box is in the site-wide footer, the asset gates sit on five
 * different pages, the notify modal is on every event page. Threading a prop
 * through all of them would mean a Supabase read on every page render, most of
 * which nobody ever types into. This fetches once, on demand, only when a form
 * actually mounts.
 *
 * Scope is deliberately narrow: name, email, phone, school. The full
 * registration prefill also carries date of birth, gender, health conditions
 * and emergency contacts — that belongs in the JS of a registration page the
 * member deliberately opened, not in every page that happens to have a footer.
 * Forms needing the full record (registration, group join, the grant
 * application) take it as a server prop instead.
 *
 * Returns `{}` for a signed-out visitor — not a 401. There is nothing wrong
 * with being signed out here; the form simply renders empty, exactly as before.
 */
export async function GET() {
  try {
    const prefill = await getRegistrationPrefill()
    if (!prefill) return NextResponse.json({}, { headers: { 'cache-control': 'no-store' } })

    return NextResponse.json(
      {
        firstName: prefill.first_name ?? '',
        lastName: prefill.last_name ?? '',
        email: prefill.email,
        phone: prefill.phone ?? '',
        schoolName: prefill.school_name ?? '',
      },
      // Personal data keyed to a session — must never be cached by a CDN or a
      // shared browser cache.
      { headers: { 'cache-control': 'no-store, private' } },
    )
  } catch (err) {
    console.error('[members/me/prefill] Lookup failed (non-fatal):', err)
    return NextResponse.json({}, { headers: { 'cache-control': 'no-store' } })
  }
}
