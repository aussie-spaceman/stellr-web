// @vitest-environment node
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowedTenantFiles } from '@/lib/tenancy/tenant-surface'
import { importClosureOf, readRepoFile } from './import-closure'
import { pageProblems, requestReads } from './tenant-tree-lint'

// The tenant tree's rule (S5, B5b). A Stellr flow page reads its record by slug or
// token alone, so a tenant page that only re-exported it would render another tenant's
// record. Each page here takes the tenant from its URL param and passes it to a loader
// in lib/tenancy/tenant-records.ts before anything renders.
//
// And nothing a tenant page reaches may decide the tenant from the request. A plain ban
// on headers() and cookies() can't pass, because check-in needs its cookie, so each
// call in the import closure is listed here by name with its reason. A new one fails
// until someone writes down why it isn't deciding the tenant. Clerk's auth() reads the
// request inside the package: that is who is signed in, which is the same on any host.

const TREE = 'app/%5Ft'
const FLOW_TREE = `${TREE}/[tenant]/(flow)`

const treeFiles = (): string[] =>
  readdirSync(path.join(process.cwd(), TREE), { recursive: true, encoding: 'utf8' })
    .map((rel) => path.posix.join(TREE, rel.split(path.sep).join('/')))
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel))

const flowPages = () => treeFiles().filter((f) => f.startsWith(`${FLOW_TREE}/`) && f.endsWith('/page.tsx'))

/** Pages with no record of their own to check. */
const RECORDLESS: Record<string, string> = {
  [`${FLOW_TREE}/sign/page.tsx`]: 'reads nothing on the server: the key is in the URL fragment, so the check is in the signing APIs',
  [`${FLOW_TREE}/sign/copy/page.tsx`]: 'reads nothing on the server: the key is in the URL fragment, so the check is in the signing APIs',
}

/** Every headers() or cookies() call a tenant page can reach, and why it isn't deciding the tenant. */
const REQUEST_READS: Record<string, string> = {
  'app/(stellr)/(flow)/check-in/[slug]/page.tsx#CheckInPage:cookies': "the phone's signed check-in cookie for this event slug: who is checking in, not which tenant",
  'lib/impersonation.ts#viewAsState:cookies': 'the admin view-as cookie, read inside the identity helpers: who the person is, on any host',
  'lib/request-nonce.ts#requestNonce:headers': "this response's CSP nonce, for ClerkProvider's script tag",
  'lib/tenancy/request-tenant.ts#requestTenant:headers': 'for app/api only: it sits beside tenantFromParams, and the banned list below fails any call to it in the closure',
}

const closure = (entries: string[], read = readRepoFile) => importClosureOf(entries, read)

function measure(entries: string[], read = readRepoFile) {
  const calls = new Set<string>()
  const banned = new Set<string>()
  for (const file of closure(entries, read)) {
    const found = requestReads(file, read(file) ?? '')
    for (const c of found.calls) calls.add(c)
    for (const b of found.banned) banned.add(b)
  }
  return { calls: [...calls].sort(), banned: [...banned].sort() }
}

describe('the tenant page tree', () => {
  it('has one page for each flow page allowed on a tenant host, and no others', () => {
    const allowed = allowedTenantFiles().filter((f) => f.startsWith('app/(stellr)/(flow)/') && f.endsWith('/page.tsx'))
    expect(allowed).toHaveLength(16)
    expect(flowPages().sort()).toEqual(allowed.map((f) => f.replace('app/(stellr)/(flow)/', `${FLOW_TREE}/`)).sort())
  })

  it('resolves the tenant from params and checks the record on every page', () => {
    const problems = flowPages().flatMap((file) =>
      pageProblems(file, readRepoFile(file) ?? '', { recordless: file in RECORDLESS }).map((p) => `${file}: ${p}`),
    )
    expect(problems).toEqual([])
  })

  it('lists no recordless page that has gone', () => {
    expect(Object.keys(RECORDLESS).filter((f) => readRepoFile(f) === null)).toEqual([])
  })

  it('every loader takes the tenant first', () => {
    const src = readRepoFile('lib/tenancy/tenant-records.ts') ?? ''
    const exported = [...src.matchAll(/export async function (\w+)\((\w+):/g)]
    expect(exported.length).toBeGreaterThanOrEqual(7)
    expect(exported.filter((m) => m[2] !== 'tenant').map((m) => m[1])).toEqual([])
  })

  it('walks into the Stellr flow code it reuses', () => {
    const walked = closure(treeFiles())
    expect(walked.size).toBeGreaterThan(100)
    for (const file of [
      'app/(stellr)/(flow)/survey/[token]/survey-body.tsx',
      'app/(stellr)/(flow)/register/[slug]/individual/individual-body.tsx',
      'app/(stellr)/(flow)/register/[slug]/confirmation/confirmation-body.tsx',
      'lib/survey/access.ts',
      'lib/tenancy/request-tenant.ts',
    ]) {
      expect(walked.has(file), file).toBe(true)
    }
  })

  it('reads the request only where this file says why', () => {
    expect(measure(treeFiles()).calls).toEqual(Object.keys(REQUEST_READS).sort())
  })

  it('never reads a Host or tenant header, and never calls requestTenant', () => {
    expect(measure(treeFiles()).banned).toEqual([])
  })

  it("can't reach the registration prefill, which reads a member's roster row from any organiser", () => {
    expect([...closure(treeFiles())].filter((f) => f === 'lib/registration-prefill.ts')).toEqual([])
  })
})

describe('the check itself', () => {
  const FILE = `${FLOW_TREE}/survey/[token]/page.tsx`
  const GOOD = `
    import SurveyPage from '@/app/(stellr)/(flow)/survey/[token]/page'
    import { tenantFromParams } from '@/lib/tenancy/request-tenant'
    import { requireTenantSurveyInvitation } from '@/lib/tenancy/tenant-records'
    export const dynamic = 'force-dynamic'
    export default async function P({ params }) {
      const tenant = await tenantFromParams(params)
      const { token } = await params
      await requireTenantSurveyInvitation(tenant, token)
      return <SurveyPage params={Promise.resolve({ token })} />
    }`

  it('passes the shape every page uses', () => {
    expect(pageProblems(FILE, GOOD)).toEqual([])
  })

  it.each([
    ['export default from a Stellr page', "export { default } from '@/app/(stellr)/(flow)/survey/[token]/page'\n"],
    ['import then export default', "import P from '@/app/(stellr)/(flow)/survey/[token]/page'\nexport default P\n"],
    ['export star', "export * from '@/app/(stellr)/(flow)/survey/[token]/page'\nexport { default } from '@/app/(stellr)/(flow)/survey/[token]/page'\n"],
  ])('fails a bare re-export: %s', (_name, src) => {
    expect(pageProblems(FILE, src).join()).toContain('bare re-export')
  })

  it('fails a page that ignores params.tenant', () => {
    const src = GOOD.replace('const tenant = await tenantFromParams(params)\n', '').replace('await requireTenantSurveyInvitation(tenant, token)\n', '')
    expect(pageProblems(FILE, src)).toContain('never calls tenantFromParams(params)')
  })

  it('fails a page with the tenant check and no record check', () => {
    const src = GOOD.replace('await requireTenantSurveyInvitation(tenant, token)\n', '')
    expect(pageProblems(FILE, src).join()).toContain('never calls a loader')
  })

  it('fails a record check that does not take the tenant from params', () => {
    const src = GOOD.replace('requireTenantSurveyInvitation(tenant, token)', "requireTenantSurveyInvitation({ tenantId: 'x' }, token)")
    expect(pageProblems(FILE, src).join()).toContain('first argument')
  })

  it('fails an un-awaited record check', () => {
    const src = GOOD.replace('await requireTenantSurveyInvitation', 'void requireTenantSurveyInvitation')
    expect(pageProblems(FILE, src).join()).toContain('not awaited')
  })

  it('fails a page that renders before its record check', () => {
    const src = GOOD.replace('await requireTenantSurveyInvitation(tenant, token)\n', '').replace(
      'return <SurveyPage params={Promise.resolve({ token })} />',
      'const out = <SurveyPage params={Promise.resolve({ token })} />\nawait requireTenantSurveyInvitation(tenant, token)\nreturn out',
    )
    expect(pageProblems(FILE, src).join()).toContain('renders before its record check')
  })

  it.each([
    ['swallowed by a try', 'try { await requireTenantSurveyInvitation(tenant, token) } catch {}'],
    ['behind an if', "if (token === 'never') await requireTenantSurveyInvitation(tenant, token)"],
    ['behind a short circuit', "token === 'never' && (await requireTenantSurveyInvitation(tenant, token))"],
    ['in a nested function', 'const later = async () => { await requireTenantSurveyInvitation(tenant, token) }\nawait later()'],
  ])('fails a record check that can be skipped or swallowed: %s', (_name, check) => {
    const src = GOOD.replace('await requireTenantSurveyInvitation(tenant, token)', check)
    expect(pageProblems(FILE, src).join()).toContain('plain statement of the page function')
  })

  it('fails a tenant check that can be swallowed', () => {
    const src = GOOD.replace('const tenant = await tenantFromParams(params)', 'let tenant\ntry { tenant = await tenantFromParams(params) } catch {}')
    expect(pageProblems(FILE, src).join()).toContain('tenantFromParams must be a plain statement')
  })

  it('fails a record check on some other record than the one the URL names', () => {
    const src = GOOD.replace('requireTenantSurveyInvitation(tenant, token)', "requireTenantEvent(tenant, 'some-own-event')").replace('requireTenantSurveyInvitation }', 'requireTenantEvent }')
    const problems = pageProblems(FILE, src).join()
    expect(problems).toContain('take token from the page params')
    expect(problems).toContain('only the page params')
  })

  it('fails a page that skips one of the params in its path', () => {
    const JOIN = `${FLOW_TREE}/register/[slug]/join/[token]/page.tsx`
    const src = GOOD.replace('const { token } = await params', 'const { slug, token } = await params')
    expect(pageProblems(JOIN, src).join()).toContain('take slug from the page params')
  })

  it('fails a param shadowed by something not from the URL', () => {
    const src = GOOD.replace('const { token } = await params', "const token = 'fixed'")
    expect(pageProblems(FILE, src).join()).toContain('destructure token')
  })

  it('fails a tenant taken from anything but params', () => {
    const src = GOOD.replace('tenantFromParams(params)', "tenantFromParams({ tenant: 'x' })")
    expect(pageProblems(FILE, src).join()).toContain('page params')
  })

  const page = 'app/%5Ft/[tenant]/page.tsx'
  const fixture = (files: Record<string, string>) => (rel: string) => files[rel] ?? null

  it('finds a headers() call two imports away, by name', () => {
    const read = fixture({
      [page]: "import { x } from '@/app/(stellr)/(flow)/thing'\nexport default x\n",
      'app/(stellr)/(flow)/thing.ts': "export { x } from '@/lib/deep'\n",
      'lib/deep.ts': "import { headers as h } from 'next/headers'\nexport async function x() { return (await h()).get('accept') }\n",
    })
    expect(measure([page], read).calls).toEqual(['lib/deep.ts#x:headers'])
  })

  it('finds a cookies() call through a namespace import and in an arrow function', () => {
    const src = "import * as nh from 'next/headers'\nexport const read = async () => (await nh.cookies()).get('a')\n"
    expect(requestReads('lib/a.ts', src).calls).toEqual(['lib/a.ts#read:cookies'])
  })

  it('does not count a comment, or a type-only import', () => {
    expect(requestReads('lib/a.ts', "// headers()\nimport type { cookies } from 'next/headers'\nexport const a = 1\n").calls).toEqual([])
  })

  it.each([
    ['the Host header', "export const f = (h) => h.get('host')\n", 'reads the host header'],
    ['a forwarded host', "export const f = (h) => h.get('X-Forwarded-Host')\n", 'reads the X-Forwarded-Host header'],
    ['the tenant header by name', "export const f = (h) => h.get('x-stellr-tenant-id')\n", 'reads the x-stellr-tenant-id header'],
    ['the tenant header constant', "import { TENANT_ID_HEADER } from '@/lib/tenancy/host'\nexport const f = (h) => h.get(TENANT_ID_HEADER)\n", 'names TENANT_ID_HEADER'],
    ['requestTenant', "import { requestTenant } from '@/lib/tenancy/request-tenant'\nexport const f = () => requestTenant()\n", 'calls requestTenant()'],
    ['a dynamic next/headers', "export const f = () => import('next/headers')\n", 'loads next/headers dynamically'],
  ])('bans %s anywhere in the closure', (_name, src, expected) => {
    expect(requestReads('lib/a.ts', src).banned.join()).toContain(expected)
  })

  it('a new read in real code fails the listed set', () => {
    const planted = (rel: string) => {
      const src = readRepoFile(rel)
      return rel === 'lib/survey/access.ts' ? `import { cookies } from 'next/headers'\nexport const planted = () => cookies()\n${src}` : src
    }
    expect(measure(treeFiles(), planted).calls).toContain('lib/survey/access.ts#planted:cookies')
  })
})
