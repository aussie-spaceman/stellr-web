import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review MP-8: a scholarship application must NOT be pushed into the
// marketing CRM. The form is addressed to students and asks no age, so an
// applicant may be a child; captureLead created a HubSpot contact with a
// marketing lifecycle stage and the tracking cookie. The application is still
// stored and emailed to staff — only the marketing capture is removed.

const h = vi.hoisted(() => ({
  captureLead: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => {}),
  rlGuard: vi.fn((): Response | null => null),
  insert: vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'app-1' }, error: null }) }) })),
  impersonating: false,
}))

vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail }))
// The route must no longer import these — but mock them so that if the
// marketing capture is ever reintroduced, this test catches the call.
vi.mock('@/lib/hubspot', () => ({ captureLead: h.captureLead, logLine: () => 'log', readHubspotCookie: () => 'hutk' }))
vi.mock('@/lib/hubspot-fields', () => ({ LEAD_SOURCE_LIFECYCLE: { scholarship: 'lead' } }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: h.rlGuard, HOUR_MS: 3_600_000 }))
vi.mock('@/lib/sanity', () => ({ getAllEvents: async () => [] }))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/scholarship-emails', () => ({
  scholarshipReceivedEmail: () => ({ subject: '', html: '', text: '' }),
  scholarshipTeamInboxEmail: () => ({ subject: '', html: '', text: '' }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: () => ({ insert: h.insert }) }) }))
vi.mock('@/lib/impersonation', () => ({
  assertNotImpersonating: async () =>
    h.impersonating ? new Response(JSON.stringify({ error: 'Read-only', impersonating: true }), { status: 403 }) : null,
}))

const { POST } = await import('./route')
import { captureLead } from '@/lib/hubspot'

function post() {
  return POST(
    new Request('https://www.stellreducation.org/api/scholarship', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Robin', lastName: 'Doe', email: 'robin@example.com',
        activity: 'Space Design Challenge', brief: 'I would love to take part.',
      }),
    }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.rlGuard.mockReturnValue(null)
  h.impersonating = false
})

describe('POST /api/scholarship', () => {
  it('MP-8: never captures the applicant as a marketing lead', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('still stores the application and alerts staff', async () => {
    await post()
    expect(h.insert).toHaveBeenCalledTimes(1)
    // staff alert + applicant acknowledgement
    expect(h.sendEmail).toHaveBeenCalled()
  })

  // S0 (Nov 2026): getCurrentMember() resolves to the viewed member during
  // view-as, so an admin's submission would be filed as theirs.
  it('is refused while an admin is viewing as a member: nothing stored or sent', async () => {
    h.impersonating = true
    const res = await post()
    expect(res.status).toBe(403)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })
})
