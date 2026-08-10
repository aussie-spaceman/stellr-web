import { describe, it, expect, vi, beforeEach } from 'vitest'

const { captureLead, getEventBySlug } = vi.hoisted(() => ({
  captureLead: vi.fn(async (_input: unknown) => ({
    ok: true,
    via: 'form' as const,
    noteLogged: true,
    warnings: [],
  })),
  getEventBySlug: vi.fn(async (_slug: string) => ({
    title: 'Nevada Space Design Challenge',
    type: 'Space Design Challenge',
    gradeLevel: 'High School',
    setting: 'in_person',
    city: 'Las Vegas',
    state: 'NV',
    date: '2026-11-06',
  })),
}))

vi.mock('@/lib/hubspot', async () => {
  const actual = await vi.importActual<typeof import('@/lib/hubspot')>('@/lib/hubspot')
  return { ...actual, captureLead, readHubspotCookie: () => undefined }
})
vi.mock('@/lib/sanity', () => ({ getEventBySlug }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitGuard: () => null, HOUR_MS: 3_600_000 }))

const { POST } = await import('./route')

function post(body: unknown) {
  return POST(
    new Request('https://www.stellreducation.org/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

const lastCapture = () => captureLead.mock.calls.at(-1)?.[0] as any

beforeEach(() => {
  captureLead.mockClear()
  getEventBySlug.mockClear()
})

describe('POST /api/subscribe — event notify', () => {
  it('captures an event signup as event_notify with the full taxonomy', async () => {
    const res = await post({
      name: 'Steve Martin',
      email: 'steve@example.com',
      source: 'event-notify',
      eventSlug: 'nevada-space-design-challenge-2027',
      interest: 'individual',
    })

    expect(res.status).toBe(200)
    const arg = lastCapture()
    expect(arg.source).toBe('event_notify')
    expect(arg.properties.event_slug).toBe('nevada-space-design-challenge-2027')
    expect(arg.properties.event).toBe('Nevada [Las Vegas]')
    expect(arg.properties.registration_interest_type).toBe('Individual')
    expect(arg.activity).toMatch(/Requested registration updates/)
  })

  /**
   * A deploy does not reload tabs that are already open, so for a while after
   * every release the previous bundle posts to the current route. The old
   * bundle sent the slug as `event`; when the route only read `eventSlug` the
   * signup silently degraded to a generic newsletter capture with no event
   * fields at all. That is exactly what happened to the first post-deploy test,
   * and it is invisible — the visitor still sees "You're on the list".
   */
  it('accepts the legacy `event` key from a stale client bundle', async () => {
    const res = await post({
      name: 'Steve Martin',
      email: 'steve@example.com',
      source: 'event-notify',
      event: 'nevada-space-design-challenge-2027',
    })

    expect(res.status).toBe(200)
    const arg = lastCapture()
    expect(arg.source).toBe('event_notify')
    expect(arg.properties.event_slug).toBe('nevada-space-design-challenge-2027')
    expect(arg.activity).toMatch(/Requested registration updates/)
  })

  it('prefers eventSlug when a client sends both', async () => {
    await post({
      email: 'steve@example.com',
      source: 'event-notify',
      eventSlug: 'new-slug',
      event: 'old-slug',
    })
    expect(getEventBySlug).toHaveBeenCalledWith('new-slug')
  })

  it('records Unspecified when no button intent was sent', async () => {
    await post({ email: 'a@b.com', source: 'event-notify', eventSlug: 'x' })
    expect(lastCapture().properties.registration_interest_type).toBe('Unspecified')
  })

  it('still captures when the slug resolves to no Sanity document', async () => {
    getEventBySlug.mockResolvedValueOnce(null as never)
    await post({ email: 'a@b.com', source: 'event-notify', eventSlug: 'ghost-event' })

    const arg = lastCapture()
    expect(arg.source).toBe('event_notify')
    expect(arg.properties.event_slug).toBe('ghost-event')
    // No taxonomy invented for an event we cannot resolve.
    expect(arg.properties.event).toBeUndefined()
  })
})

describe('POST /api/subscribe — newsletter', () => {
  it('treats a footer subscribe as newsletter', async () => {
    await post({ email: 'a@b.com' })
    const arg = lastCapture()
    expect(arg.source).toBe('newsletter')
    expect(arg.activity).toMatch(/website footer/)
  })

  it('does not treat a blank slug as an event signup', async () => {
    await post({ email: 'a@b.com', source: 'event-notify', eventSlug: '   ' })
    expect(lastCapture().source).toBe('newsletter')
  })

  it('rejects an invalid email', async () => {
    expect((await post({ email: 'nope' })).status).toBe(400)
    expect(captureLead).not.toHaveBeenCalled()
  })

  it('reports a failed capture rather than claiming success', async () => {
    captureLead.mockResolvedValueOnce({
      ok: false,
      via: 'none',
      noteLogged: false,
      warnings: ['all-writes-failed'],
    } as never)
    expect((await post({ email: 'a@b.com' })).status).toBe(502)
  })
})
