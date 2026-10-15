import { NextResponse } from 'next/server'
import { getMemberCampaignContext } from '@/lib/campaign-registrations'

/**
 * The signed-in member's campaign state for the public event pages: which
 * campaigns they've registered for, and their school and tier for the "no
 * payment needed" note. The pages themselves no longer read the session, so
 * they can be served from the CDN; this fills in the member-specific bits in
 * the browser, and only for a browser with a session (lib/session-hint).
 *
 * Signed-out visitors get the empty shape, not a 401.
 */
export async function GET() {
  try {
    const ctx = await getMemberCampaignContext()
    return NextResponse.json(
      { registeredSlugs: [...ctx.registeredSlugs], membership: ctx.membership },
      { headers: { 'cache-control': 'private, no-store' } }
    )
  } catch (err) {
    console.error('[campaign-context] failed:', err)
    return NextResponse.json({ registeredSlugs: [], membership: null }, { headers: { 'cache-control': 'private, no-store' } })
  }
}
