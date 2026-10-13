import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))

// The module reads these once at import, so they must be set beforehand.
vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'test-token')
vi.stubEnv('HUBSPOT_PORTAL_ID', '24379847')
vi.stubEnv('HUBSPOT_FORM_EVENT_NOTIFY', 'form-guid')

const { captureLead } = await import('./hubspot')

/**
 * The event properties are multi-selects that hold a contact's history, and a
 * HubSpot write replaces a multi-select's whole value. A 2025 Texas
 * participant who asks about Nevada must end up tagged with both — not
 * re-tagged as Nevada-only, which is what a straight write did.
 */

const EMAIL = 'returning@example.com'

function stubHubSpot(contact: { status: number; properties?: Record<string, string> }) {
  const submitted: Record<string, string>[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (url.includes('/submissions/v3/')) {
        const body = JSON.parse(String(init?.body)) as { fields: { name: string; value: string }[] }
        submitted.push(Object.fromEntries(body.fields.map((f) => [f.name, f.value])))
        return new Response('{}', { status: 200 })
      }
      if (method === 'GET' && url.includes('/crm/v3/objects/contacts/')) {
        if (contact.status !== 200) return new Response('{}', { status: contact.status })
        return new Response(JSON.stringify({ id: '42', properties: contact.properties ?? {} }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ id: '1' }), { status: 200 })
    }),
  )
  return submitted
}

const NEVADA = {
  event: 'Nevada [Las Vegas]',
  event_year: '2027',
  event_theme: 'Space',
  event_demographic: 'High School',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('captureLead — multi-select event history', () => {
  it('merges onto what the contact already holds', async () => {
    const submitted = stubHubSpot({
      status: 200,
      properties: { event: 'Texas [Houston]', event_year: '2025', event_theme: 'Space' },
    })

    await captureLead({ email: EMAIL, source: 'event_notify', activity: 'test', properties: NEVADA })

    expect(submitted[0]).toMatchObject({
      event: 'Texas [Houston];Nevada [Las Vegas]',
      event_year: '2025;2027',
      event_theme: 'Space',
      event_demographic: 'High School',
    })
  })

  it('writes the value as-is for a brand-new contact', async () => {
    const submitted = stubHubSpot({ status: 404 })
    await captureLead({ email: EMAIL, source: 'event_notify', activity: 'test', properties: NEVADA })
    expect(submitted[0]).toMatchObject(NEVADA)
  })

  it('leaves the event fields out when the contact could not be read', async () => {
    // A 500 is "don't know what is there" — merging onto nothing would replace it.
    const submitted = stubHubSpot({ status: 500 })
    const result = await captureLead({
      email: EMAIL,
      source: 'event_notify',
      activity: 'test',
      properties: { ...NEVADA, event_slug: 'nevada-space-design-challenge' },
    })

    for (const key of Object.keys(NEVADA)) expect(submitted[0]).not.toHaveProperty(key)
    // The rest of the capture still lands.
    expect(submitted[0]).toMatchObject({ event_slug: 'nevada-space-design-challenge' })
    expect(result.warnings).toContain('multi-select-skipped-unreadable')
  })
})
