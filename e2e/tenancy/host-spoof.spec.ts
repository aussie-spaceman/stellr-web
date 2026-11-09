import { expect, test } from '@playwright/test'
import { FLAG_OFF_PORT, FLAG_ON_PORT, HARNESS_APP_HOST, STELLR_HOSTS, STELLR_ZONE_HOST, UNKNOWN_ZONE_HOST, mapLimit, rawGet, stubStats } from '../fixtures/tenant-hosts'
import { differences, echoedIn, fingerprint, redirectMoved, type RawResponse } from './body-hash'
import { documentShape, shapeDifferences } from './document-shape'
import { OWNERS, OWNER_A, OWNER_B, OWNER_STELLR, type RecordOwner } from './harness-records'
import { MISSING_CREDENTIAL, RECORD_PAGES, harnessCheckInCode as checkInCode, stellrHostTally } from './host-cases'

/**
 * Check (c), S5 B10, on the production build: a request can't choose its tenant. Not by a
 * forged header, not by naming the internal tree, and not by naming another tenant's slug
 * or token on a tenant's pages, in either direction.
 *
 * What this does not cover: the APIs, which are C6's (test/idor/tenant-host-routes.test.ts),
 * and pages past a session, since the harness has no Clerk instance. A forged tenant header
 * has no reader on a GET a signed-out request can reach, so "changes nothing" over HTTP says
 * little about those two headers; the proxy's stripping of them is held by
 * test/proxy-tenant-routing.test.ts. The harness has no platform in front of it, so the
 * forwarding headers a client sends reach the app here; on a deployment the platform sets
 * them itself, which a request to the deployed hosts confirmed on 8 Nov 2026.
 */

const TENANT_HOSTS = [OWNER_A.host, OWNER_B.host]
const EVERY_HOST = [...STELLR_HOSTS, ...TENANT_HOSTS, UNKNOWN_ZONE_HOST]

const blank = (text: string, sent: string[]) => sent.reduce((out, value) => out.split(value).join('SENT'), text)

/** A response with the URL's own ids blanked, so two URLs can be compared. */
function blanked(res: RawResponse, sent: string[]): RawResponse {
  const headers: RawResponse['headers'] = {}
  for (const [name, value] of Object.entries(res.headers)) headers[name] = typeof value === 'string' ? blank(value, sent) : value
  return { status: res.status, headers, body: blank(res.body, sent) }
}

const MISSING_IDS = ['harness-event-nobody', 'harnessnobody'.padEnd(43, 'x'), 'harness-join-nobody', 'harness-pay-nobody', 'harness-seat-nobody', MISSING_CREDENTIAL, 'p.00000000-0000-4000-8000-000000000000.nope']

function idsOf(o: RecordOwner): string[] {
  return [checkInCode(o), o.eventSlug, o.surveyToken, o.profileToken, o.joinToken, o.payToken, o.seatToken, o.credentialNumber]
}

let requests = 0

/** Each from its own address: the credential pages' per-address limit would answer 429 part way through. */
const ask = (host: string, path: string) => {
  requests++
  return rawGet(FLAG_ON_PORT, host, path, { 'X-Forwarded-For': `10.0.${(requests >> 8) & 255}.${requests & 255}` })
}

/**
 * Whether two URLs get the same answer, as far as a person can tell. Each is asked once
 * first, since a first render can carry another Link header, and Next's flight data numbers
 * its rows by what rendered first, so it's left out here. The callers read the raw body for
 * each owner's marker, flight data included.
 */
async function sameAnswer(host: string, foreign: string, missing: string, sent: string[]): Promise<string[]> {
  await ask(host, foreign)
  await ask(host, missing)
  const a = blanked(await ask(host, foreign), sent)
  const b = blanked(await ask(host, missing), MISSING_IDS)
  return shapeDifferences(documentShape(a, FLAG_ON_PORT), documentShape(b, FLAG_ON_PORT))
}

const FORGED_NONCE = 'forged-nonce'

test.describe('forged headers change nothing', () => {
  const forgedTo = (target: RecordOwner): Record<string, string> => ({
    'X-Forwarded-Host': target.host,
    'X-Original-Host': target.host,
    'X-Host': target.host,
    Forwarded: `host=${target.host};proto=https`,
    'x-stellr-tenant-id': target.tenantId,
    'x-stellr-tenant-slug': target.tenantSlug,
    'x-nonce': FORGED_NONCE,
    'x-stellr-private-route': '1',
    'x-middleware-subrequest': 'proxy:proxy:proxy:proxy:proxy',
    'x-matched-path': `/_t/${target.tenantSlug}/sign`,
    'x-invoke-path': `/_t/${target.tenantSlug}/sign`,
  })

  const SAMPLE = (o: RecordOwner) => ['/', '/about', '/sign', '/privacy', '/check-in', '/admin', '/account/onboarding', '/community', `/survey/${o.surveyToken}`, `/survey/event/${o.eventSlug}`, '/api/sign/context', '/no-such-file.png']

  // Signed out, Clerk answers these with an absolute redirect to sign-in, built from the
  // forwarded host the platform sets. With no platform in front that host may be the forged
  // one and nothing else may move: see redirectMoved.
  const CLERK_REDIRECTS = new Set(['/admin', '/account/onboarding'])

  async function compare(host: string, target: RecordOwner, port: number, paths: string[]) {
    const results = await mapLimit(paths, 4, async (path) => {
      // Warm first: Next's Link header can differ on a server's first render of a route.
      await rawGet(port, host, path)
      const plain = await rawGet(port, host, path)
      const forged = await rawGet(port, host, path, forgedTo(target))
      // Read raw: a fingerprint masks every nonce attribute, whatever its value.
      const echoed = echoedIn(forged, FORGED_NONCE).map((where) => `forged nonce in ${where}`)
      if (CLERK_REDIRECTS.has(path) && plain.status === 307) {
        const moved = forged.status === 307 ? redirectMoved(plain.headers.location, forged.headers.location, target.host) : [`status 307 vs ${forged.status}`]
        return { path, diff: [...echoed, ...moved] }
      }
      return { path, diff: [...echoed, ...differences(fingerprint(plain, port), fingerprint(forged, port))] }
    })
    return results.filter((r) => r.diff.length).map((r) => `${host} ${r.path}: ${r.diff.join(', ')}`)
  }

  for (const host of STELLR_HOSTS) {
    test(`on ${host}, naming a tenant`, async () => {
      expect(await compare(host, OWNER_A, FLAG_ON_PORT, SAMPLE(OWNER_A))).toEqual([])
    })
  }

  for (const [host, target, own] of [
    [OWNER_A.host, OWNER_B, OWNER_A],
    [OWNER_B.host, OWNER_A, OWNER_B],
    [OWNER_A.host, OWNER_STELLR, OWNER_A],
  ] as const) {
    test(`on ${host}, naming ${target.tenantSlug}`, async () => {
      expect(await compare(host, target, FLAG_ON_PORT, [...SAMPLE(own), ...SAMPLE(target).slice(7)])).toEqual([])
    })
  }

  test('with routing off too', async () => {
    expect(await compare('localhost', OWNER_A, FLAG_OFF_PORT, SAMPLE(OWNER_A))).toEqual([])
  })

  test('an unknown host in the zone stays a 404, whatever it names', async () => {
    for (const path of ['/', '/sign', '/about', `/survey/${OWNER_A.surveyToken}`]) {
      for (const target of OWNERS) {
        const res = await rawGet(FLAG_ON_PORT, UNKNOWN_ZONE_HOST, path, forgedTo(target))
        expect(res.status, `${path} naming ${target.name}`).toBe(404)
        expect(res.body).not.toContain(target.marker)
      }
    }
  })
})

test.describe('the Host header itself', () => {
  test('each spelling of a tenant host is that tenant', async () => {
    const own = `/survey/${OWNER_A.surveyToken}`
    for (const host of [OWNER_A.host, OWNER_A.host.toUpperCase(), `${OWNER_A.host}.`, `${OWNER_A.host}:${FLAG_ON_PORT}`]) {
      const res = await rawGet(FLAG_ON_PORT, host, own)
      expect(res.status, host).toBe(200)
      expect(res.body, host).toContain(OWNER_A.marker)
    }
  })

  test('a host that only looks like one is refused', async () => {
    for (const host of [`x.${OWNER_A.host}`, `${OWNER_A.tenantSlug}-.localhost`, `${OWNER_A.host}@evil.test.localhost`, 'bad host.localhost', `_${OWNER_A.host}`]) {
      const res = await rawGet(FLAG_ON_PORT, host, `/survey/${OWNER_A.surveyToken}`)
      expect(res.status, host).toBe(404)
      expect(res.body, host).not.toContain(OWNER_A.marker)
    }
  })

  test('no spelling of the zone apex or a tenant host reaches a denied route', async () => {
    for (const host of [OWNER_A.host, OWNER_A.host.toUpperCase(), `${OWNER_A.host}.`, `${OWNER_A.host}:${FLAG_ON_PORT}`]) {
      for (const path of ['/admin', '/community', '/about']) expect((await rawGet(FLAG_ON_PORT, host, path)).status, `${host} ${path}`).toBe(404)
    }
  })
})

test.describe('the tree by its own URL', () => {
  const PREFIXES = ['/_t/', '/%5Ft/', '/%5ft/', '/_%74/', '/%5F%74/', '/_T/']
  const TAILS = ['', '/sign', '/check-in', '/x.html', '/x.png', '/x.pngfoo', '/sign/x.html', `/survey/${OWNER_A.surveyToken}`, `/survey/${OWNER_A.surveyToken}.png`]
  const SLUGS = ['stellr', OWNER_A.tenantSlug, OWNER_B.tenantSlug, 'no-tenant']

  for (const [name, port] of [['routing on', FLAG_ON_PORT], ['routing off', FLAG_OFF_PORT]] as const) {
    test(`404 on every host, for every slug, ${name}`, async () => {
      const urls = PREFIXES.flatMap((prefix) => SLUGS.flatMap((slug) => TAILS.map((tail) => `${prefix}${slug}${tail}`)))
      const asks = EVERY_HOST.flatMap((host) => urls.map((path) => ({ host, path })))
      const answers = await mapLimit(asks, 8, async ({ host, path }) => {
        const res = await rawGet(port, host, path)
        return { host, path, status: res.status, leak: OWNERS.filter((o) => res.body.includes(o.marker)).length }
      })
      expect(answers.length).toBe(EVERY_HOST.length * PREFIXES.length * SLUGS.length * TAILS.length)
      expect(answers.filter((a) => a.status !== 404 || a.leak > 0)).toEqual([])
    })
  }

  // The control: the same tree, by the only way in.
  test('the rewrite reaches it', async () => {
    expect((await rawGet(FLAG_ON_PORT, OWNER_A.host, '/sign')).status).toBe(200)
    expect((await rawGet(FLAG_ON_PORT, OWNER_B.host, '/sign')).status).toBe(200)
  })
})

test.describe('a denied path with a dotted suffix', () => {
  const DENIED = ['/admin', '/admin/members', '/community', '/community/spaces', '/home', '/account', '/about', '/events', '/store', '/join', '/studio', '/academy', '/api/admin/health/integrations', '/api/community/spaces', '/api/cron/weekly-digest']
  const SUFFIXES = ['.html', '.png', '.pngfoo', '.json', '.js', '/x.html', '/x.png', '/x.css/y', '/.png']

  const stellrIn = (body: string) => ['application/ld+json', 'dataLayer', 'data-consent-needed', 'Stellr Education'].filter((text) => body.includes(text))

  test('404 on a tenant host, with none of Stellr’s document', async () => {
    const asks = TENANT_HOSTS.flatMap((host) => DENIED.flatMap((path) => SUFFIXES.map((suffix) => ({ host, path: `${path}${suffix}` }))))
    const answers = await mapLimit(asks, 8, async ({ host, path }) => {
      const res = await rawGet(FLAG_ON_PORT, host, path)
      return { host, path, status: res.status, stellr: stellrIn(res.body) }
    })
    expect(answers.filter((a) => a.status !== 404 || a.stellr.length > 0)).toEqual([])
  })

  // Next drops a trailing slash before the proxy runs, on the same host, and then it is
  // the path above.
  test('with a trailing slash, the same 404 one redirect later', async () => {
    const asks = TENANT_HOSTS.flatMap((host) => DENIED.map((path) => ({ host, path: `${path}.png` })))
    const answers = await mapLimit(asks, 8, async ({ host, path }) => {
      const first = await rawGet(FLAG_ON_PORT, host, `${path}/`)
      const then = await rawGet(FLAG_ON_PORT, host, String(first.headers.location))
      return { host, path, first: first.status, location: first.headers.location, then: then.status, stellr: stellrIn(then.body) }
    })
    expect(answers.filter((a) => a.first !== 308 || a.location !== a.path || a.then !== 404 || a.stellr.length > 0)).toEqual([])
  })

  test('a dotted suffix on an allowed path, naming a record, is a 404 too', async () => {
    for (const o of [OWNER_A, OWNER_B]) {
      const other = o === OWNER_A ? OWNER_B : OWNER_A
      for (const id of [o, other]) {
        for (const path of [`/survey/${id.surveyToken}.png`, `/survey/${id.surveyToken}.html`, `/team-profile/${id.profileToken}.png`, `/register/${id.eventSlug}.png`, `/register/${id.eventSlug}/pay/${id.payToken}.html`, `/check-in/${id.eventSlug}.pngfoo`, `/check-in/${id.eventSlug}/code.png`]) {
          const res = await rawGet(FLAG_ON_PORT, o.host, path)
          expect(res.status, `${o.host} ${path}`).toBe(404)
          expect(res.body, `${o.host} ${path}`).not.toContain(id.marker)
        }
      }
    }
  })
})

test.describe('a record named on a host it does not belong to', () => {
  const FOREIGN_PAIRS = [
    [OWNER_A, OWNER_B],
    [OWNER_B, OWNER_A],
    [OWNER_A, OWNER_STELLR],
    [OWNER_B, OWNER_STELLR],
  ] as const

  for (const page of RECORD_PAGES) {
    const name = page.file.replace('app/(stellr)/', '')

    test(`${name}: its own host answers as the table says`, async () => {
      for (const o of [OWNER_A, OWNER_B]) {
        const res = await ask(o.host, page.path(o, checkInCode))
        if (page.ownHost.kind === 'shows') {
          expect(res.status, o.host).toBe(200)
          expect(res.body, o.host).toContain(page.ownHost.text(o))
        } else {
          expect(res.status, o.host).toBe(404)
        }
      }
    })

    test(`${name}: 404 for another owner’s record, the same as for no record`, async () => {
      for (const [host, owner] of FOREIGN_PAIRS) {
        const path = page.path(owner, checkInCode)
        const foreign = await ask(host.host, path)
        const where = `${owner.name}'s record on ${host.host}`
        expect(foreign.status, where).toBe(404)
        for (const id of OWNERS) expect(foreign.body, where).not.toContain(id.marker)
        expect(await sameAnswer(host.host, path, page.missing, idsOf(owner)), where).toEqual([])
      }
    })
  }

  test('the record check runs on a page that cannot show its own record here', async () => {
    const pages = RECORD_PAGES.filter((page) => page.ownHost.kind === 'noCms')
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const before = (await stubStats()).recordReads.events ?? 0
      await rawGet(FLAG_ON_PORT, OWNER_A.host, page.path(OWNER_A, checkInCode))
      expect((await stubStats()).recordReads.events ?? 0, page.file).toBeGreaterThan(before)
    }
  })

  test('another tenant’s valid check-in code shows nobody on a tenant’s own event page', async () => {
    const res = await rawGet(FLAG_ON_PORT, OWNER_A.host, `/check-in/${OWNER_A.eventSlug}/code?c=${checkInCode(OWNER_B)}`)
    expect(res.status).toBe(200)
    expect(res.body).toContain('This check-in code isn’t valid')
    expect(res.body).not.toContain(OWNER_B.marker)
  })
})

/**
 * Stellr's hosts, asked for a record of another owner. Each row of host-cases.ts records the
 * answer today and the slice that owns it, so that slice's change has to update the row in
 * its own commit. A pass here does not meet the gate: see host-cases.ts and the tally below.
 */
test.describe('Recorded by slice: another owner’s record on a Stellr host', () => {
  const HOSTS = ['localhost', STELLR_ZONE_HOST]

  for (const page of RECORD_PAGES) {
    const outcome = page.onStellrHost
    const name = page.file.replace('app/(stellr)/', '')

    test(`${outcome.owner}, ${outcome.kind}: ${name}`, async () => {
      if (outcome.kind === 'noCms') test.info().annotations.push({ type: 'not proven here', description: `The harness has no CMS. ${outcome.owner}'s two-tenant test has to prove this page.` })
      for (const host of HOSTS) {
        for (const o of [OWNER_A, OWNER_B]) {
          const path = page.path(o, checkInCode)
          const res = await ask(host, path)
          const where = `${o.name} on ${host}`
          if (outcome.kind === 'answers') {
            expect(res.status, where).toBe(200)
            expect(res.body, where).toContain(outcome.text(o))
          } else if (outcome.kind === 'noCms') {
            expect(res.status, where).toBe(404)
            expect(res.body, where).not.toContain(o.marker)
          } else {
            const missing = await ask(host, page.missing)
            expect(res.status, where).toBe(missing.status)
            expect(res.body, where).not.toContain(o.marker)
            expect(await sameAnswer(host, path, page.missing, idsOf(o)), where).toEqual([])
          }
        }
      }
    })
  }

  // So a credential row above can't pass by never being read, as a number in the wrong
  // format would.
  test('the credential rows are read', async () => {
    const pages = RECORD_PAGES.filter((page) => page.file.includes('/credentials/'))
    expect(pages.length).toBeGreaterThan(0)
    for (const page of pages) {
      const before = (await stubStats()).recordReads.credentials ?? 0
      await ask('localhost', page.path(OWNER_A, checkInCode))
      expect((await stubStats()).recordReads.credentials ?? 0, page.file).toBeGreaterThan(before)
    }
  })

  // The job goes green with rows still open, so its log says how many.
  test('the tally', () => {
    console.log(stellrHostTally())
  })

  // The check-in pages in full, since the amendment names them: with no code, or a bad one,
  // the code page says the same for a tenant's slug as for a slug nobody has.
  test('A12: the code page with no valid code says the same for a tenant’s slug as for none', async () => {
    const bad = 'c=p.00000000-0000-4000-8000-000000000000.nope'
    for (const host of HOSTS) {
      const [tenant, nobody] = await Promise.all([
        rawGet(FLAG_ON_PORT, host, `/check-in/${OWNER_B.eventSlug}/code?${bad}`),
        rawGet(FLAG_ON_PORT, host, `/check-in/harness-event-nobody/code?${bad}`),
      ])
      expect(tenant.status).toBe(200)
      expect(nobody.status).toBe(200)
      expect(tenant.body).not.toContain(OWNER_B.marker)
      expect(await sameAnswer(host, `/check-in/${OWNER_B.eventSlug}/code?${bad}`, `/check-in/harness-event-nobody/code?${bad}`, [OWNER_B.eventSlug, bad.slice(2)])).toEqual([])
    }
  })

  // The control: Stellr's own records still answer on Stellr's hosts, and a code signed for
  // Stellr's event still shows Stellr's person.
  test('Stellr’s own records answer on Stellr’s hosts', async () => {
    for (const host of ['localhost', STELLR_ZONE_HOST, 'www.stellreducation.org']) {
      const survey = await rawGet(FLAG_ON_PORT, host, `/survey/${OWNER_STELLR.surveyToken}`)
      expect(survey.status, host).toBe(200)
      expect(survey.body, host).toContain(OWNER_STELLR.marker)
      const code = await rawGet(FLAG_ON_PORT, host, `/check-in/${OWNER_STELLR.eventSlug}/code?c=${checkInCode(OWNER_STELLR)}`)
      expect(code.status, host).toBe(200)
      expect(code.body, host).toContain(OWNER_STELLR.marker)
    }
    expect((await rawGet(FLAG_ON_PORT, HARNESS_APP_HOST, `/survey/${OWNER_STELLR.surveyToken}`)).status).toBe(200)
  })
})

test('an unknown host in the zone answers 404 for every record', async () => {
  for (const page of RECORD_PAGES) {
    for (const o of OWNERS) {
      const res = await rawGet(FLAG_ON_PORT, UNKNOWN_ZONE_HOST, page.path(o, checkInCode))
      expect(res.status, `${o.name} ${page.file}`).toBe(404)
      expect(res.body, `${o.name} ${page.file}`).not.toContain(o.marker)
    }
  }
})
