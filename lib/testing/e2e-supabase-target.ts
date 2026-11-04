// Which Supabase project the e2e suite may write to.
//
// The suite's fixtures write and delete rows with the secret key, so each one
// refuses any database it does not recognise. There are exactly two: the shared
// dev project, and the disposable stack CI starts on the runner's loopback
// (docs/RUNBOOK-ci-database.md, "The e2e-local job"). An allowlist on purpose:
// production is refused because it is not listed, not because it is named here.
//
// The hostname is compared whole. A substring check would accept a URL that only
// mentions the dev ref, such as https://evil.example/?x=<ref>.
//
// No dependencies: e2e fixtures, tsx CLIs and scripts all import this.

export const DEV_SUPABASE_REF = 'xvxlhbxtiwxpopoqjygm'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

function hostnameOf(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null
  } catch {
    return null
  }
}

/** True for a Supabase stack on this machine. Only such a stack may be seeded from scratch. */
export function isLoopbackSupabase(url: string | null | undefined): boolean {
  const host = hostnameOf(url)
  return host !== null && LOOPBACK_HOSTS.has(host)
}

/** True for the two databases the e2e suite may write to. */
export function isAllowedE2eSupabase(url: string | null | undefined): boolean {
  return hostnameOf(url) === `${DEV_SUPABASE_REF}.supabase.co` || isLoopbackSupabase(url)
}

/** Throws unless NEXT_PUBLIC_SUPABASE_URL is one of those two. Returns the URL. */
export function assertE2eSupabase(url: string | null | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  if (!isAllowedE2eSupabase(url)) {
    throw new Error(
      'The e2e fixtures run only against the dev Supabase project or a stack on this machine, ' +
        `and NEXT_PUBLIC_SUPABASE_URL is neither (host: ${hostnameOf(url) ?? 'unset or not a URL'}).`,
    )
  }
  return url as string
}
