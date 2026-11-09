// The tenant-host harness's settings and safety checks (S5, B10a). Plain .mjs so
// build-harness.mjs and the Playwright config share them with no compile step.
//
// The harness holds no real key and reaches no real database. Its Supabase URL is
// a stub on this machine (host-map-stub.ts), and NEXT_PUBLIC_* values are inlined
// at build, so it needs a build of its own. The checks below refuse any other build.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const STUB_PORT = 54399
export const FLAG_OFF_PORT = 4101
export const FLAG_ON_PORT = 4102
export const STUB_URL = `http://127.0.0.1:${STUB_PORT}`
export const TENANT_ZONE = '.localhost'
export const STATS_PATH = '/__harness/stats'

/** The member-app host of this build. It never resolves: `.test` is reserved. */
export const HARNESS_APP_HOST = 'app.stellr-harness.test'
const HARNESS_SITE_HOST = 'www.stellr-harness.test'

// A well-formed development key for a Clerk instance that does not exist. A plain
// placeholder fails Clerk's parser when a page renders. Signed-out requests never
// call Clerk, so a page answers the same as it would with a real key.
const FAKE_CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from('tenant-harness.clerk.accounts.dev$').toString('base64')}`

/** Inlined at build. Two hosts, as in production, so the member-app branch of the proxy runs. */
export const HARNESS_BUILD_ENV = {
  NEXT_PUBLIC_APP_ENV: 'dev',
  NEXT_PUBLIC_SUPABASE_URL: STUB_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'harness-publishable-key',
  NEXT_PUBLIC_SITE_URL: `http://${HARNESS_SITE_HOST}`,
  NEXT_PUBLIC_AUTH_APP_URL: `http://${HARNESS_APP_HOST}`,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: FAKE_CLERK_PUBLISHABLE_KEY,
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL: '/account',
  NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL: '/account/onboarding',
  NEXT_PUBLIC_MEDIA_BASE_URL: 'https://l3zabozgfpz3vahd.public.blob.vercel-storage.com',
  // Emitted only when set, so without them losing the tags would go unseen.
  NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION: 'harness-google-verification',
  NEXT_PUBLIC_BING_SITE_VERIFICATION: 'harness-bing-verification',
  // Containers and portals that do not exist. Stellr's tags render nothing without them,
  // so check (d)'s localhost control could not show a tag loading. Its browser never
  // lets a third-party request leave the machine.
  NEXT_PUBLIC_GTM_ID: 'GTM-HARNESS',
  NEXT_PUBLIC_HUBSPOT_PORTAL_ID: '00000000',
  // Signs check-in codes, here only, so check (c) can name another tenant's real code.
  CREDENTIAL_LINK_SECRET: 'harness-check-in-signing-value-0123456789',
  SUPABASE_SECRET_KEY: 'harness-secret-key',
  CLERK_SECRET_KEY: 'sk_test_harness_placeholder',
  // verify's build type-checks this code. See next.config.mjs.
  SKIP_BUILD_TYPECHECK: '1',
}

/** What the two servers read at run time. The routing settings are the only difference. */
export function harnessServerEnv(routing) {
  return {
    ...HARNESS_BUILD_ENV,
    TENANT_ROUTING_ENABLED: routing ? 'true' : '',
    TENANT_HOST_SUFFIX: routing ? TENANT_ZONE : '',
  }
}

// Next loads these files for any variable the environment leaves unset, so a real
// key in one of them would reach the build or the servers. The test pair matters
// only if NODE_ENV=test gets through, which scrubInheritedSettings prevents; both
// guards stay, since either alone would quietly stop holding.
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local', '.env.test', '.env.test.local']

// What the shell, Node, npx and Playwright's own processes need. Everything else is
// dropped, so a new integration's key cannot slip through by having a new name.
// NODE_ENV is left out on purpose: Next picks which env files to load from it.
const KEPT_SETTINGS = new Set([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'PWD', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TZ',
  'CI', 'GITHUB_ACTIONS', 'GITHUB_WORKSPACE',
  'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'FORCE_COLOR', 'NO_COLOR', 'DEBUG_COLORS', 'NEXT_TELEMETRY_DISABLED',
  'TEST_WORKER_INDEX', 'TEST_PARALLEL_INDEX', 'E2E_TENANT_HOST_LOGS', 'E2E_DOCUMENT_CAPTURE', 'E2E_TENANT_HOST_NO_BROWSER',
])
const KEPT_PREFIXES = /^(LC_|PLAYWRIGHT_|PW_|PWTEST_|PWDEBUG)/

/** Keeps only what the tools need, in this process and so in anything it starts. */
export function scrubInheritedSettings(env = process.env) {
  for (const name of Object.keys(env)) {
    if (!KEPT_SETTINGS.has(name) && !KEPT_PREFIXES.test(name)) delete env[name]
  }
}

export function assertNoEnvFiles(exists = existsSync) {
  const found = ENV_FILES.filter((file) => exists(file))
  if (found.length > 0) {
    throw new Error(
      `The tenant-host harness refuses to run beside ${found.join(', ')}: Next would load real settings from it. ` +
        'Move it aside, or run from a worktree without one.',
    )
  }
}

const MARKER = 'tenant-host-harness.json'

/** Written after the harness build. `next build` empties .next, so another build removes it. */
export function writeHarnessMarker(nextDir = '.next') {
  const buildId = readFileSync(join(nextDir, 'BUILD_ID'), 'utf8').trim()
  writeFileSync(join(nextDir, MARKER), JSON.stringify({ buildId, supabaseUrl: STUB_URL }))
}

/**
 * Refuses any build but the harness's own, before a server starts. Another build
 * has another database inlined, and the pages it renders may write to it.
 */
export function assertHarnessBuild(nextDir = '.next') {
  const rebuild = 'Run: node e2e/tenancy/build-harness.mjs'
  const markerFile = join(nextDir, MARKER)
  const buildIdFile = join(nextDir, 'BUILD_ID')
  if (!existsSync(markerFile) || !existsSync(buildIdFile)) {
    throw new Error(`.next is not the tenant-host harness's build. ${rebuild}`)
  }
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'))
  const buildId = readFileSync(buildIdFile, 'utf8').trim()
  if (marker.buildId !== buildId || marker.supabaseUrl !== STUB_URL) {
    throw new Error(`.next does not match the tenant-host harness's build marker. ${rebuild}`)
  }
}
