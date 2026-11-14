import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { isValidElement, type ReactElement } from 'react'
import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A file inside @clerk/nextjs, located by resolving the package (its main entry is dist/cjs/index.js). */
function clerkNextjsFile(file: string): string {
  return join(dirname(createRequire(import.meta.url).resolve('@clerk/nextjs')), '..', '..', file)
}

// S1 CSP (lib/csp.ts): the scripts on a nonce route that 'strict-dynamic' does
// NOT cover, because no trusted script inserts them, and how each is allowed.
//
//   clerk-js: a parser-inserted <script src> in the server HTML. It needs the
//     request's nonce, which proxy.ts hands the layouts as `x-nonce` and each
//     Clerk layout passes to its ClerkProvider.
//   GTM's init: next/script injects it inline (el.textContent) with no nonce,
//     because the App Router gives next/script no nonce. Its sha256 is in the
//     nonce policy instead.

const NONCE = 'bm9uY2Utb2YtdGhpcy1yZXE='

const mocks = vi.hoisted(() => ({ nonce: 'bm9uY2Utb2YtdGhpcy1yZXE=' as string | null }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(mocks.nonce ? { 'x-nonce': mocks.nonce } : {}),
}))

// The layouts' own data reads, stubbed: only the ClerkProvider props matter here.
vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: 'user_1', sessionClaims: { metadata: { role: 'admin' } } }),
}))
vi.mock('@/lib/community', () => ({ getCurrentMember: async () => null }))
vi.mock('@/lib/impersonation', () => ({ viewAsBannerProps: async () => null }))
vi.mock('@/lib/sessions', () => ({ getHostCaps: async () => null }))
vi.mock('@/lib/member-outstanding', () => ({ getOutstandingItems: async () => [] }))

afterEach(() => {
  mocks.nonce = NONCE
  vi.unstubAllEnvs()
})

describe('clerk-js carries the request nonce', () => {
  it('Clerk stamps a nonce on its script tag only when one is passed', async () => {
    // Not in the package's exports map, so by path, found through the package's
    // own resolution (a worktree without its own node_modules finds its parent's).
    // It is what both the client ClerkScripts and the server DynamicClerkScripts render.
    const path = clerkNextjsFile('dist/esm/utils/clerk-script-tags.js')
    const { ClerkScriptTags } = (await import(/* @vite-ignore */ path)) as {
      ClerkScriptTags: (props: { publishableKey: string; nonce?: string }) => React.JSX.Element
    }
    const key = `pk_test_${Buffer.from('clerk.example.org$').toString('base64')}`
    const without = renderToStaticMarkup(<ClerkScriptTags publishableKey={key} />)
    const withNonce = renderToStaticMarkup(<ClerkScriptTags publishableKey={key} nonce={NONCE} />)
    expect(without).toMatch(/<script[^>]*clerk\.browser\.js/)
    expect(without).not.toContain('nonce=')
    expect(withNonce).toMatch(new RegExp(`<script[^>]*nonce="${NONCE}"`))
  })

  const layouts: [string, () => Promise<{ default: (p: { children: React.ReactNode }) => unknown }>][] = [
    ['(auth)', () => import('@/app/(stellr)/(auth)/layout')],
    ['(member)', () => import('@/app/(stellr)/(member)/layout')],
    ['(admin)', () => import('@/app/(stellr)/(admin)/layout')],
    ['(flow)/register', () => import('@/app/(stellr)/(flow)/register/layout')],
    // The tenant tree's only Clerk layout. There the policy is enforced, so a missing
    // nonce stops the registration forms instead of sending a report.
    ['tenant (flow)/register', () => import('@/app/%5Ft/[tenant]/(flow)/register/layout')],
  ]

  it.each(layouts)('the %s layout passes x-nonce to its ClerkProvider', async (_name, load) => {
    const { ClerkProvider } = await import('@clerk/nextjs')
    const Layout = (await load()).default
    const el = (await Layout({ children: null })) as ReactElement<{ nonce?: string }>
    expect(isValidElement(el)).toBe(true)
    expect(el.type).toBe(ClerkProvider)
    expect(el.props.nonce).toBe(NONCE)
  })

  it('passes no nonce when the proxy sent none', async () => {
    mocks.nonce = null
    const Layout = (await import('@/app/(stellr)/(auth)/layout')).default
    const el = (await Layout({ children: null })) as ReactElement<{ nonce?: string }>
    expect(el.props.nonce).toBeUndefined()
  })
})

describe("GTM's inline init script is allowed by hash on nonce routes", () => {
  it('the hash in the nonce policy matches the exact text next/script injects', async () => {
    vi.stubEnv('NEXT_PUBLIC_GTM_ID', 'GTM-TEST123')
    vi.resetModules()
    const { HeadManagerContext } = await import('next/dist/shared/lib/head-manager-context.shared-runtime')
    const { GoogleTagManager } = await import('@/components/analytics/GoogleTagManager')
    const { noncePolicy } = await import('@/lib/csp')

    // The App Router's client context: appDir only, no nonce.
    render(
      <HeadManagerContext.Provider value={{ appDir: true }}>
        <GoogleTagManager />
      </HeadManagerContext.Provider>,
    )
    window.dispatchEvent(new Event('load'))
    await vi.waitFor(() => expect(document.getElementById('gtm-init')).not.toBeNull())
    const el = document.getElementById('gtm-init') as HTMLScriptElement

    // What a browser checks: no nonce on the element, so only a hash can allow it.
    expect(el.getAttribute('nonce')).toBeNull()
    expect(el.textContent).toContain("'GTM-TEST123'")
    const hash = `'sha256-${createHash('sha256').update(el.textContent ?? '', 'utf8').digest('base64')}'`
    const policy = noncePolicy('abc', { NODE_ENV: 'production', NEXT_PUBLIC_GTM_ID: 'GTM-TEST123' })
    const scriptSrc = policy.split(';')[0]
    expect(scriptSrc).toContain(hash)
  })

  it('adds no GTM hash when no container is configured', async () => {
    const { noncePolicy } = await import('@/lib/csp')
    const scriptSrc = noncePolicy('abc', { NODE_ENV: 'production' }).split(';')[0]
    // The ConsentMode hash only.
    expect(scriptSrc.match(/'sha256-/g)).toHaveLength(1)
  })
})
