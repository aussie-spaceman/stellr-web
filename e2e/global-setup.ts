/**
 * Two checks before any spec runs.
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
  const headers: Record<string, string> = bypass
    ? { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' }
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
}
