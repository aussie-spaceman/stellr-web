// Which environment each third-party integration is actually pointed at, and a
// hard stop when a production deployment is holding sandbox credentials.
//
// This module answers "are the credentials in front of me live or sandbox?".
// It does NOT answer "where am I running?" — that lives in lib/env.ts, which
// documents the two available signals and which of them to reach for.
//
// WHY (4 Sept 2026): production issued real parental consent forms — COPPA
// consent, photo release, risk waiver — from the DocuSign DEVELOPER SANDBOX for
// three months. Every executed page carried "DEMONSTRATION DOCUMENT ONLY —
// PROVIDED BY DOCUSIGN ONLINE SIGNING SERVICE", so none of them was a binding
// signature. docs/GO-LIVE-CHECKLIST.md §4 had said "❌ STILL SANDBOX" since
// 10 June and nothing enforced it: a stale unticked box in a doc is not a control.
//
// This check MUST run inside the deployment. `vercel env pull` redacts secret
// values, so no local script and no CI step can audit what production actually
// holds — only code running with the real env can see it.
//
// Nothing here reads or returns a secret value. Environment is derived from key
// prefixes and API hostnames, both of which are safe to surface to an admin.

import { isProductionDeployment } from './env'

export type IntegrationEnvironment = 'production' | 'sandbox' | 'unconfigured'

export type Integration = 'docusign' | 'stripe' | 'clerk' | 'checkr'

// DocuSign's sandbox is a distinct host pair: account-d.docusign.com for OAuth
// and demo.docusign.net for the API. Production is account.docusign.com plus a
// region-specific host (na3/na4/eu/au/ca).docusign.net — so "not demo" is the
// only reliable test; there is no single production hostname to match.
export function docusignEnvironment(): IntegrationEnvironment {
  // 'unconfigured' means DocuSign isn't set up at all — not that the hostnames
  // are missing. lib/docusign.ts DEFAULTS an unset host pair to the sandbox, so
  // "no DOCUSIGN_BASE_PATH in production" is a sandbox deployment, not an
  // unknown one, and must be reported as such.
  if (!process.env.DOCUSIGN_ACCOUNT_ID || !process.env.DOCUSIGN_INTEGRATION_KEY) return 'unconfigured'
  const oauth = process.env.DOCUSIGN_OAUTH_URL ?? 'https://account-d.docusign.com'
  const base = process.env.DOCUSIGN_BASE_PATH ?? 'https://demo.docusign.net/restapi'
  const sandbox = base.includes('demo.docusign.net') || oauth.includes('account-d.docusign.com')
  return sandbox ? 'sandbox' : 'production'
}

export function stripeEnvironment(): IntegrationEnvironment {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!key) return 'unconfigured'
  return key.startsWith('sk_live_') ? 'production' : 'sandbox'
}

function clerkEnvironment(): IntegrationEnvironment {
  const key = process.env.CLERK_SECRET_KEY ?? ''
  if (!key) return 'unconfigured'
  return key.startsWith('sk_live_') ? 'production' : 'sandbox'
}

// Checkr has the same trap as DocuSign: lib/background-provider/checkr.ts
// DEFAULTS an unset CHECKR_BASE_URL to api.checkr-staging.com, so a production
// deployment holding a key but no base URL is ordering staging checks — which
// return canned results for mock candidates and prove nothing about a real
// person working with minors. 'unconfigured' is reserved for "no key at all".
export function checkrEnvironment(): IntegrationEnvironment {
  if (!process.env.CHECKR_API_KEY || !process.env.CHECKR_PACKAGE_SLUG) return 'unconfigured'
  const base = process.env.CHECKR_BASE_URL ?? 'https://api.checkr-staging.com/v1'
  return base.includes('checkr-staging.com') ? 'sandbox' : 'production'
}

export function integrationEnvironments(): Record<Integration, IntegrationEnvironment> {
  return {
    docusign: docusignEnvironment(),
    stripe:   stripeEnvironment(),
    clerk:    clerkEnvironment(),
    checkr:   checkrEnvironment(),
  }
}

export class SandboxCredentialsError extends Error {
  readonly integration: Integration
  constructor(integration: Integration) {
    super(
      `Refusing to act: this is a PRODUCTION deployment but ${integration} is pointed at its sandbox/test environment. ` +
      `Anything issued here would not be real. Fix the ${integration.toUpperCase()}_* variables in Vercel (Production scope) and redeploy.`,
    )
    this.name = 'SandboxCredentialsError'
    this.integration = integration
  }
}

/**
 * Throws when a production deployment is about to perform a real-world side
 * effect (issue a legal agreement, take a payment) using sandbox credentials.
 *
 * Deliberately a no-op outside production, so local dev and preview deployments
 * keep working against the sandbox exactly as before.
 *
 * Gated on isProductionDeployment() (VERCEL_ENV), not isProd() (APP_ENV),
 * because this check exists to catch what nobody remembered to configure — and
 * APP_ENV is itself something you can forget to set. See lib/env.ts.
 */
export function assertLiveCredentials(integration: Integration): void {
  if (!isProductionDeployment()) return
  const env = integrationEnvironments()[integration]
  if (env === 'sandbox') throw new SandboxCredentialsError(integration)
}
