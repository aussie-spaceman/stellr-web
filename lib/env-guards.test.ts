import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  assertLiveCredentials,
  checkrEnvironment,
  isRealProductionApp,
  docusignEnvironment,
  stripeEnvironment,
  integrationEnvironments,
  SandboxCredentialsError,
} from './env-guards'

// Regression cover for the failure this guard exists to stop: a Vercel
// PRODUCTION deployment issuing real parental consent forms from the DocuSign
// developer sandbox, which stamps every executed page "DEMONSTRATION DOCUMENT
// ONLY" and is not a binding signature.
//
// VERCEL_ENV is the input here because that is what assertLiveCredentials keys
// off. The two "where am I" signals themselves — appEnv()/isProd() against
// vercelTarget()/isProductionDeployment(), and why they must stay distinct —
// live in lib/env.ts and are covered in lib/cron.test.ts.

const SAVED = { ...process.env }

const PROD_DOCUSIGN = {
  DOCUSIGN_ACCOUNT_ID: 'acct',
  DOCUSIGN_INTEGRATION_KEY: 'key',
  DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
  DOCUSIGN_BASE_PATH: 'https://na4.docusign.net/restapi',
}
const SANDBOX_DOCUSIGN = {
  DOCUSIGN_ACCOUNT_ID: 'acct',
  DOCUSIGN_INTEGRATION_KEY: 'key',
  DOCUSIGN_OAUTH_URL: 'https://account-d.docusign.com',
  DOCUSIGN_BASE_PATH: 'https://demo.docusign.net/restapi',
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith('DOCUSIGN_') ||
      k.startsWith('CHECKR_') ||
      k === 'VERCEL_ENV' ||
      k === 'NEXT_PUBLIC_APP_ENV' ||
      k === 'STRIPE_SECRET_KEY' ||
      k === 'CLERK_SECRET_KEY'
    ) {
      delete process.env[k]
    }
  }
})
afterEach(() => { process.env = { ...SAVED } })

describe('docusignEnvironment', () => {
  it('detects the sandbox host pair', () => {
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    expect(docusignEnvironment()).toBe('sandbox')
  })

  it('detects a production region host', () => {
    Object.assign(process.env, PROD_DOCUSIGN)
    expect(docusignEnvironment()).toBe('production')
  })

  it('reports MISSING host vars as sandbox, not unknown', () => {
    // lib/docusign.ts defaults an unset host pair to demo.docusign.net, so
    // "no DOCUSIGN_BASE_PATH in production" IS a sandbox deployment. Reporting
    // it as 'unconfigured' would let exactly this bug through the guard.
    process.env.DOCUSIGN_ACCOUNT_ID = 'acct'
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key'
    expect(docusignEnvironment()).toBe('sandbox')
  })

  it('is unconfigured only when DocuSign is not set up at all', () => {
    expect(docusignEnvironment()).toBe('unconfigured')
  })
})

describe('assertLiveCredentials', () => {
  it('throws on a production deployment pointed at the DocuSign sandbox', () => {
    process.env.VERCEL_ENV = 'production'
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    expect(() => assertLiveCredentials('docusign')).toThrow(SandboxCredentialsError)
  })

  it('allows a production deployment on production DocuSign', () => {
    process.env.VERCEL_ENV = 'production'
    Object.assign(process.env, PROD_DOCUSIGN)
    expect(() => assertLiveCredentials('docusign')).not.toThrow()
  })

  it('leaves preview and local development on the sandbox untouched', () => {
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    process.env.VERCEL_ENV = 'preview'
    expect(() => assertLiveCredentials('docusign')).not.toThrow()
    delete process.env.VERCEL_ENV
    expect(() => assertLiveCredentials('docusign')).not.toThrow()
  })

  it('does not block when the integration is simply unconfigured', () => {
    // An unconfigured integration fails on its own with a clearer error; this
    // guard is only about pointing at the wrong environment.
    process.env.VERCEL_ENV = 'production'
    expect(() => assertLiveCredentials('docusign')).not.toThrow()
  })

  it('applies the same rule to Stripe test keys', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    expect(stripeEnvironment()).toBe('sandbox')
    expect(() => assertLiveCredentials('stripe')).toThrow(SandboxCredentialsError)
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    expect(() => assertLiveCredentials('stripe')).not.toThrow()
  })
})

describe('checkrEnvironment', () => {
  it('is unconfigured without both a key and a package slug', () => {
    expect(checkrEnvironment()).toBe('unconfigured')
    process.env.CHECKR_API_KEY = 'key'
    expect(checkrEnvironment()).toBe('unconfigured')
  })

  it('reports a MISSING base URL as sandbox, not unknown', () => {
    // lib/background-provider/checkr.ts defaults CHECKR_BASE_URL to the staging
    // host, so a production deployment with a key and no URL is on staging.
    process.env.CHECKR_API_KEY = 'key'
    process.env.CHECKR_PACKAGE_SLUG = 'stellr_crimid'
    expect(checkrEnvironment()).toBe('sandbox')
  })

  it('detects the explicit staging and production hosts', () => {
    process.env.CHECKR_API_KEY = 'key'
    process.env.CHECKR_PACKAGE_SLUG = 'stellr_crimid'
    process.env.CHECKR_BASE_URL = 'https://api.checkr-staging.com/v1'
    expect(checkrEnvironment()).toBe('sandbox')
    process.env.CHECKR_BASE_URL = 'https://api.checkr.com/v1'
    expect(checkrEnvironment()).toBe('production')
  })

  it('blocks a production deployment from ordering staging background checks', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.CHECKR_API_KEY = 'key'
    process.env.CHECKR_PACKAGE_SLUG = 'stellr_crimid'
    expect(() => assertLiveCredentials('checkr')).toThrow(SandboxCredentialsError)
    process.env.CHECKR_BASE_URL = 'https://api.checkr.com/v1'
    expect(() => assertLiveCredentials('checkr')).not.toThrow()
  })
})

describe('the dev project builds its own "production" target', () => {
  // WHY (22 Sept 2026): stellr-web-dev builds the `dev` branch as ITS
  // production, so VERCEL_ENV=production is true on a deployment that is meant
  // to run against sandboxes. Keyed on VERCEL_ENV alone, this guard threw on
  // every integration there — it surfaced as a 503 on the Checkr order route,
  // the one place background-check certification can run, and the same trap sat
  // under Stripe checkout, Clerk provisioning and DocuSign issuance.
  beforeEach(() => {
    process.env.VERCEL_ENV = 'production'
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc'
    process.env.CHECKR_API_KEY = 'key'
    process.env.CHECKR_PACKAGE_SLUG = 'stellr_crimid'
  })

  it('lets the dev deployment use every sandbox when it declares APP_ENV=dev', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'dev'
    expect(isRealProductionApp()).toBe(false)
    for (const i of ['docusign', 'stripe', 'checkr'] as const) {
      expect(() => assertLiveCredentials(i), i).not.toThrow()
    }
  })

  it('still guards the real production app', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'prod'
    expect(isRealProductionApp()).toBe(true)
    expect(() => assertLiveCredentials('checkr')).toThrow(SandboxCredentialsError)
  })

  it('treats a MISSING or misspelt APP_ENV as production — unset must never disarm the guard', () => {
    // The incident this module exists for came from a variable nobody had set.
    delete process.env.NEXT_PUBLIC_APP_ENV
    expect(isRealProductionApp()).toBe(true)
    expect(() => assertLiveCredentials('docusign')).toThrow(SandboxCredentialsError)

    process.env.NEXT_PUBLIC_APP_ENV = 'develop' // not the magic word
    expect(isRealProductionApp()).toBe(true)
    expect(() => assertLiveCredentials('docusign')).toThrow(SandboxCredentialsError)
  })

  it('APP_ENV=dev does not arm anything on a preview or local run either', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.NEXT_PUBLIC_APP_ENV = 'dev'
    expect(isRealProductionApp()).toBe(false)
    delete process.env.VERCEL_ENV
    expect(isRealProductionApp()).toBe(false)
  })
})

describe('integrationEnvironments', () => {
  it('reports every integration at once for the admin health check', () => {
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    expect(integrationEnvironments()).toEqual({
      docusign: 'sandbox',
      stripe: 'production',
      clerk: 'unconfigured',
      checkr: 'unconfigured',
    })
  })
})
