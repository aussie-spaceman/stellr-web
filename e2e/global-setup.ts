import { clerkSetup } from '@clerk/testing/playwright'

/**
 * Two checks before any spec runs, plus Clerk's testing setup.
 *
 * 1. Refuse production.
 * 2. Refuse a target that is not actually serving this app.
 *
 * The second exists because of a false green on 10 Sept. The dev deployment sits
 * behind Vercel Authentication, so every request 302'd to vercel.com/sso-api and
 * the suite spent its run asserting against `<title>Login – Vercel</title>`.
 * That page has an <h1> and logs no console errors, so twenty-one checks passed
 * while testing nothing at all.
 *
 * A suite that cannot tell the difference between the app and a login wall is
 * worse than no suite, because it reports confidence it has not earned. So the
 * target is probed once, up front, and anything that is not this app is a hard
 * failure rather than a green run.
 */
const FORBIDDEN_HOSTS = [
  'www.stellreducation.org',
  'app.stellreducation.org',
  'stellreducation.org',
  'stellr-web.vercel.app',
  'stellr-web-stellreducation.vercel.app',
  'stellr-web-git-main-stellreducation.vercel.app',
]

export default async function globalSetup() {
  // Exchanges the secret key for a testing token, so auth.setup.ts can sign in
  // without meeting Clerk's bot-detection and new-device challenges.
  if (process.env.CLERK_SECRET_KEY) await clerkSetup()

  const raw = process.env.E2E_BASE_URL
  if (!raw) return // localhost, started by the config's webServer

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: ${raw}`)
  }

  if (FORBIDDEN_HOSTS.includes(url.host)) {
    throw new Error(
      `\nRefusing to run the E2E suite against production (${url.host}).\n\n` +
        'These tests sign in as fixture members and write rows. Point\n' +
        'E2E_BASE_URL at the dev deployment or a preview URL instead.\n',
    )
  }

  if (url.host.endsWith('.stellreducation.org')) {
    throw new Error(
      `\nRefusing to run against ${url.host} — a stellreducation.org host that is\n` +
        'not a known dev target.\n',
    )
  }

  await assertServingTheApp(url)
}

async function assertServingTheApp(url: URL) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET

  // Header only — deliberately NOT 'x-vercel-set-bypass-cookie'.
  //
  // That header makes Vercel answer 307 -> '/' so it can set the _vercel_jwt
  // cookie on the redirect. A browser keeps the cookie and the second request
  // succeeds; `fetch` does not, so it re-requests '/', is redirected again, and
  // loops until Node gives up with "redirect count exceeded" — which this file
  // then reported as "the deployment never built". The target was healthy the
  // whole time. The cookie is only useful where something retains it, which is
  // the browser context in e2e/fixtures/test.ts, not these probes.
  const headers: Record<string, string> = bypass
    ? { 'x-vercel-protection-bypass': bypass }
    : {}

  let response: Response
  try {
    response = await fetch(url.toString(), { headers, redirect: 'manual' })
  } catch (error) {
    throw new Error(`\nCould not reach ${url.host}: ${(error as Error).message}\n`)
  }

  const location = response.headers.get('location') ?? ''

  if (location.includes('vercel.com/sso-api')) {
    throw new Error(
      `\n${url.host} is behind Vercel Authentication — every request redirects to\n` +
        'a Vercel login page, so the suite would assert against that instead of\n' +
        'the app and report a meaningless green.\n\n' +
        'Fix by generating a bypass token:\n' +
        '  Vercel → stellr-web-dev → Settings → Deployment Protection →\n' +
        '  Protection Bypass for Automation → generate, then set\n' +
        '  VERCEL_AUTOMATION_BYPASS_SECRET in .env.local and in CI.\n\n' +
        (bypass
          ? '  VERCEL_AUTOMATION_BYPASS_SECRET is set but was not accepted —\n' +
            '  regenerate it, or confirm it belongs to this project.\n'
          : '  VERCEL_AUTOMATION_BYPASS_SECRET is not currently set.\n'),
    )
  }

  if (response.status >= 400) {
    throw new Error(`\n${url.host} returned ${response.status} for /. Nothing to test against.\n`)
  }

  // Positive identification, not absence of known-bad pages.
  //
  // Twice now this suite has reported a confident green while pointed at
  // something that was not the app: first a Vercel login page, then Vercel's
  // "Deployment is building" placeholder shown because the deployment sat
  // QUEUED and never built. Both have an <h1> and neither logs app console
  // errors, so every visual assertion passed.
  //
  // Enumerating those two would just wait for a third. So the target must
  // positively identify as this app before any spec runs.
  let body: string
  try {
    const followed = await fetch(url.toString(), { headers, redirect: 'follow' })

    // Did we stay on the host we were asked to test?
    //
    // WHY (10 Sept 2026): with NEXT_PUBLIC_SITE_URL unset, lib/env.ts falls back
    // to the production origins and proxy.ts correctly redirects localhost's
    // public routes to www.stellreducation.org. The smoke suite followed the
    // redirect and asserted a non-error status and one <h1> — both true of the
    // live site — so it passed while never loading local code at all.
    //
    // Nothing above catches that: the target is reachable, is not a Vercel
    // placeholder, is not a login page, and DOES contain "Stellr". It is simply
    // the wrong deployment. Identity has to include the host, not just the app.
    const landed = new URL(followed.url)
    if (landed.host !== url.host) {
      throw new Error(
        `\n${url.host} redirects to ${landed.host} — the suite would test that\n` +
          'instead, and report a green for a deployment nobody asked about.\n\n' +
          (/stellreducation\.org$/.test(landed.host)
            ? 'That is PRODUCTION. Almost always NEXT_PUBLIC_SITE_URL and\n' +
              'NEXT_PUBLIC_AUTH_APP_URL are unset, so lib/env.ts falls back to the\n' +
              'production origins and proxy.ts redirects off localhost.\n\n' +
              `Fix: set both to http://${url.host} in .env.local — \`npm run dev\`\n` +
              'now writes them for you.\n'
            : 'Set NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_AUTH_APP_URL to match the\n' +
              'host actually being tested.\n'),
      )
    }

    body = await followed.text()
  } catch (error) {
    // Our own diagnostics are already phrased for a human; only transport
    // failures need interpreting below.
    if (error instanceof Error && error.message.startsWith('\n')) throw error

    const cause = (error as { cause?: Error }).cause?.message ?? (error as Error).message
    if (/redirect count exceeded/i.test(cause)) {
      throw new Error(
        `\n${url.host} is stuck in a redirect loop.\n\n` +
          'NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_AUTH_APP_URL most likely disagree\n' +
          'with the host actually serving the request, so proxy.ts redirects a\n' +
          'public route to itself. Compare all three.\n\n' +
          'Note this is NOT how an unbuilt deployment presents — that serves a\n' +
          'Vercel placeholder and is reported separately below.\n',
      )
    }
    throw new Error(`\nCould not read ${url.host}: ${cause}\n`)
  }

  if (/Deployment is building|DEPLOYMENT_NOT_FOUND|Deployment has failed/i.test(body)) {
    throw new Error(
      `\n${url.host} is serving a Vercel placeholder, not the app — the deployment\n` +
        'is still building, missing, or failed. Wait for it to be READY, then re-run.\n',
    )
  }

  if (!/Stellr/i.test(body)) {
    throw new Error(
      `\n${url.host} does not look like this app: its home page never mentions\n` +
        '"Stellr". Refusing to run — a suite that cannot tell the app from a\n' +
        'placeholder reports confidence it has not earned.\n',
    )
  }
}
