/**
 * production-guard.mjs — is this .env.local carrying production credentials?
 *
 * Pure: takes the file's text, returns what tripped. scripts/dev.mjs calls it
 * before starting `next dev` and refuses to start if anything did.
 *
 * WHY (15 Sept 2026): the main checkout's .env.local held the production Clerk
 * instance (pk_live_) and the production Supabase project with its service_role
 * key — full write access, RLS bypassed. `npm run dev` there was a local server
 * with production credentials, and it was found serving a pk_live_ build on
 * port 3000 while the Playwright suite ran against it. A second worktree was in
 * the same state. The cause was .env.local.example, which named the production
 * ref; every worktree copied from it started pointed at production.
 *
 * .env.local.example is fixed and dev.mjs pins local origins, but both are
 * conventions. This is the control: a worktree that names production cannot
 * start a dev server, whatever the template said when it was copied.
 */

/** The production Supabase project ref. Belongs only in Vercel's Production scope. */
export const PRODUCTION_SUPABASE_REF = 'hwtzpfrnksksxlwwabqz'

/** Set to '1' to start anyway — for the rare, deliberate, read-only look at production. */
export const OVERRIDE_VAR = 'ALLOW_PROD_LOCALLY'

/** `NAME=value` on its own line; quotes and surrounding whitespace stripped. */
function valueOf(text, name) {
  const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`, 'm'))
  if (!match) return null
  return match[1].trim().replace(/^["']|["']$/g, '')
}

/**
 * The first production credential in a .env.local body, or null when clean.
 *
 * Checks the assignment lines only — a comment that mentions the production
 * ref (the example file has one, explaining why it must not be used) is fine.
 *
 * @param {string} text  the contents of .env.local
 * @returns {{ name: string, reason: string } | null}
 */
export function productionCredentialIn(text) {
  const supabase = valueOf(text, 'NEXT_PUBLIC_SUPABASE_URL')
  if (supabase && supabase.includes(PRODUCTION_SUPABASE_REF)) {
    return {
      name: 'NEXT_PUBLIC_SUPABASE_URL',
      reason: `names the PRODUCTION Supabase project (${PRODUCTION_SUPABASE_REF})`,
    }
  }

  const clerk = valueOf(text, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
  if (clerk && clerk.startsWith('pk_live_')) {
    return {
      name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      reason: 'is a pk_live_ key — the PRODUCTION Clerk instance',
    }
  }

  return null
}

/**
 * The refusal printed by dev.mjs. Names the variable, says what to do, and
 * names the override — so nobody has to open this file to get unstuck.
 *
 * @param {{ name: string, reason: string }} hit
 * @returns {string}
 */
export function refusalMessage(hit) {
  return [
    `dev: refusing to start — .env.local ${hit.name} ${hit.reason}.`,
    '',
    '     A local dev server on these credentials has full write access to',
    '     production member data. Repoint .env.local at the dev environment:',
    '',
    '       NEXT_PUBLIC_SUPABASE_URL         https://xvxlhbxtiwxpopoqjygm.supabase.co',
    '       NEXT_PUBLIC_SUPABASE_ANON_KEY    dev project anon key',
    '       SUPABASE_SERVICE_ROLE_KEY        dev project service_role key',
    '       NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY pk_test_… (brief-ox-79.clerk.accounts.dev)',
    '       CLERK_SECRET_KEY                 sk_test_…',
    '       NEXT_PUBLIC_SITE_URL             http://localhost:<PORT>',
    '       NEXT_PUBLIC_AUTH_APP_URL         http://localhost:<PORT>  (same value)',
    '       NEXT_PUBLIC_APP_ENV              dev',
    '',
    '     See docs/ENV-MATRIX.md and docs/handovers/HANDOVER-open-items-2026-09-15.md.',
    `     To start anyway, deliberately: ${OVERRIDE_VAR}=1 npm run dev`,
  ].join('\n')
}
