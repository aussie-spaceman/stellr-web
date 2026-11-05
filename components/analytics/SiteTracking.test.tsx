import { Suspense, useEffect, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteTracking } from './SiteTracking'
import { CONSENT_NEEDED_ATTR, CONSENT_STORAGE_KEY } from '@/lib/consent'

// Every tracker reports two things: that it rendered, and that its mount effect
// ran, which is when the real one would load a script. None leaves DOM, like the
// real ones, so the hydration test below compares what the server really sends.
type BeforeSend = (event: { url: string }) => { url: string } | null
const log = vi.hoisted(() => ({
  rendered: [] as string[],
  mounted: [] as string[],
  beforeSend: {} as Record<string, BeforeSend | undefined>,
}))
let pathname = '/about'
let serverBailsOut = false

function Tracker({ name, children }: { name: string; children?: ReactNode }) {
  log.rendered.push(name)
  useEffect(() => {
    log.mounted.push(name)
  }, [name])
  return <>{children}</>
}

vi.mock('next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('./GoogleTagManager', () => ({ GoogleTagManager: () => <Tracker name="gtm" /> }))
vi.mock('./HubSpotTracking', () => ({ HubSpotTracking: () => <Tracker name="hubspot" /> }))
vi.mock('@vercel/analytics/react', () => ({
  Analytics: ({ beforeSend }: { beforeSend?: BeforeSend }) => {
    log.beforeSend.analytics = beforeSend
    return <Tracker name="analytics" />
  },
}))
// The real one wraps a useSearchParams() reader in Suspense. On a prerendered
// page that reader bails out, so the server sends a marked boundary: the throw
// here gives the same markup.
vi.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: ({ beforeSend }: { beforeSend?: BeforeSend }) => {
    log.beforeSend.speedInsights = beforeSend
    return (
      <Suspense fallback={null}>
        <SpeedInsightsReader />
      </Suspense>
    )
  },
}))
function SpeedInsightsReader() {
  if (serverBailsOut) throw new Error('BAILOUT_TO_CLIENT_SIDE_RENDERING')
  return <Tracker name="speed-insights" />
}

const ALL = ['analytics', 'gtm', 'hubspot', 'speed-insights']
const STELLR = ['www.stellreducation.org', 'app.stellreducation.org', 'stellreducation.org', 'localhost', 'stellr-web-dev-x.vercel.app']
const TENANT = ['canary-academy.localhost', 'x.events.stellreducation.org', 'stellr.localhost', 'events.school.example']

function visit(hostname: string) {
  vi.stubGlobal('location', new URL(`https://${hostname}/`))
}

const banner = () => screen.queryByRole('region', { name: /cookie consent/i, hidden: true })

beforeEach(() => {
  pathname = '/about'
  serverBailsOut = false
  log.rendered.length = 0
  log.mounted.length = 0
  log.beforeSend = {}
  window.localStorage.clear()
  window.dataLayer = []
  document.documentElement.removeAttribute(CONSENT_NEEDED_ATTR)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('SiteTracking on a Stellr host', () => {
  for (const hostname of STELLR) {
    it(`mounts all five on ${hostname}`, () => {
      visit(hostname)
      render(<SiteTracking />)
      expect([...log.mounted].sort()).toEqual(ALL)
      expect(banner()).not.toBeNull()
    })
  }

  it('still leaves them all out on a private link', () => {
    visit('www.stellreducation.org')
    pathname = '/sign/abc'
    render(<SiteTracking />)
    expect(log.rendered).toEqual([])
    expect(banner()).toBeNull()
  })

  it('stops Vercel Analytics and Speed Insights reporting a private URL', () => {
    visit('www.stellreducation.org')
    render(<SiteTracking />)
    for (const send of [log.beforeSend.analytics, log.beforeSend.speedInsights]) {
      expect(send).toBeDefined()
      const open = { url: 'https://www.stellreducation.org/about' }
      expect(send?.(open)).toBe(open)
      expect(send?.({ url: 'https://www.stellreducation.org/sign/abc' })).toBeNull()
    }
  })
})

describe('SiteTracking on a tenant host', () => {
  for (const hostname of TENANT) {
    it(`mounts none of the five on ${hostname}`, () => {
      visit(hostname)
      document.documentElement.setAttribute(CONSENT_NEEDED_ATTR, '')
      render(<SiteTracking />)
      expect(log.rendered).toEqual([])
      expect(banner()).toBeNull()
      expect(document.documentElement.hasAttribute(CONSENT_NEEDED_ATTR)).toBe(false)
    })
  }

  // The component only. The ConsentMode head script has no host check and still
  // replays a stored choice until B5c moves it out of the tenant root.
  it('replays no stored consent from the component', () => {
    visit('canary-academy.localhost')
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ ads: true, decidedAt: '2026-11-04T00:00:00.000Z' }))
    render(<SiteTracking />)
    expect(window.dataLayer).toEqual([])
  })

  it('renders nothing on a private link, with no banner to flash', () => {
    visit('canary-academy.localhost')
    pathname = '/sign/abc'
    const { container } = render(<SiteTracking />)
    expect(log.rendered).toEqual([])
    expect(container.innerHTML).toBe('')
  })
})

describe('with no tenant zone configured', () => {
  beforeEach(() => {
    vi.stubEnv('TENANT_HOST_SUFFIX', '')
    vi.stubEnv('TENANT_ROUTING_ENABLED', '')
  })

  it('keeps trackers on www', () => {
    visit('www.stellreducation.org')
    render(<SiteTracking />)
    expect([...log.mounted].sort()).toEqual(ALL)
  })

  it('still keeps them off a host in the zone it does not know about', () => {
    visit('x.events.stellreducation.org')
    render(<SiteTracking />)
    expect(log.rendered).toEqual([])
    expect(banner()).toBeNull()
  })
})

describe('hydrating the markup the server sent', () => {
  // The root layout is prerendered, so the server sends the Stellr markup to
  // every host. jsdom always has a window, so the server's answer is stood in for
  // by rendering as www; SiteTracking.server.test.tsx holds the real one to it.
  // Other nodes follow it in the page, as they do in the root layout, so markup
  // left unclaimed here would be compared against them.
  const page = (
    <>
      <SiteTracking />
      <p>next in the body</p>
    </>
  )

  async function hydrateOn(hostname: string) {
    visit('www.stellreducation.org')
    serverBailsOut = true
    const html = renderToString(page)
    serverBailsOut = false
    log.rendered.length = 0

    visit(hostname)
    const container = document.createElement('div')
    document.body.appendChild(container)
    container.innerHTML = html
    const recoverable: string[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let root: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      root = hydrateRoot(container, page, {
        onRecoverableError: (e) => {
          const message = e instanceof Error ? e.message : String(e)
          // The boundary the server bailed out of reports itself on every host.
          // Next.js filters this one; anything else would be a real mismatch.
          if (!message.includes('server rendering errored')) recoverable.push(message)
        },
      })
    })
    const errors = consoleError.mock.calls
    return { html, container, recoverable, errors, unmount: () => act(async () => root?.unmount()) }
  }

  it('the server does send a banner and a marked boundary, so the test can fail', async () => {
    const { html, unmount } = await hydrateOn('www.stellreducation.org')
    expect(html).toContain('data-cookie-banner')
    expect(html).toContain('<template')
    await unmount()
  })

  it('hydrates cleanly on www and mounts all five', async () => {
    const { recoverable, errors, unmount } = await hydrateOn('www.stellreducation.org')
    expect([...log.mounted].sort()).toEqual(ALL)
    expect(recoverable).toEqual([])
    expect(errors).toEqual([])
    await unmount()
  })

  it('hydrates cleanly on a tenant host, removes the banner, and mounts none', async () => {
    const { container, recoverable, errors, unmount } = await hydrateOn('canary-academy.localhost')
    expect(log.rendered).toEqual([])
    expect(log.mounted).toEqual([])
    expect(container.querySelector('[data-cookie-banner]')).toBeNull()
    expect(container.querySelector('template')).toBeNull()
    expect(container.textContent).toBe('next in the body')
    expect(recoverable).toEqual([])
    expect(errors).toEqual([])
    await unmount()
  })

  it('hydrates cleanly on a tenant host at a private link, where the server sent nothing', async () => {
    pathname = '/sign/abc'
    const { html, container, recoverable, errors, unmount } = await hydrateOn('canary-academy.localhost')
    expect(html).not.toContain('data-cookie-banner')
    expect(log.rendered).toEqual([])
    expect(container.textContent).toBe('next in the body')
    expect(recoverable).toEqual([])
    expect(errors).toEqual([])
    await unmount()
  })
})
