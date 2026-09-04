import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  assertLiveCredentials,
  docusignEnvironment,
  stripeEnvironment,
  integrationEnvironments,
  SandboxCredentialsError,
} from './env-guards'

// Regression cover for the failure this guard exists to stop: a Vercel
// PRODUCTION deployment issuing real parental consent forms from the DocuSign
// developer sandbox, which stamps every executed page "DEMONSTRATION DOCUMENT
// ONLY" and is not a binding signature.

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
    if (k.startsWith('DOCUSIGN_') || k === 'VERCEL_ENV' || k === 'STRIPE_SECRET_KEY' || k === 'CLERK_SECRET_KEY') {
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

describe('integrationEnvironments', () => {
  it('reports every integration at once for the admin health check', () => {
    Object.assign(process.env, SANDBOX_DOCUSIGN)
    process.env.STRIPE_SECRET_KEY = 'sk_live_abc'
    expect(integrationEnvironments()).toEqual({
      docusign: 'sandbox',
      stripe: 'production',
      clerk: 'unconfigured',
    })
  })
})
