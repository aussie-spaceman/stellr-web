// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// The adapter is exercised against the real lib/docusign.ts with fetch stubbed,
// so these cases cover the request DocuSign receives and the error it returns,
// not a mock of our own client.

const ctx = { db: {} as SupabaseClient }

const adult = {
  type: 'adult' as const,
  params: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.test', eventTitle: 'Test Event' },
}

function stubDocusign(createResponse: Response) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const target = String(url)
    if (target.includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 })
    }
    if (target.endsWith('/envelopes')) return createResponse
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function loadAdapter() {
  vi.resetModules()
  const { generateKeyPairSync } = await import('node:crypto')
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('DOCUSIGN_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  vi.stubEnv('DOCUSIGN_ADULT_TEMPLATE_ID', 'adult-template')
  return {
    ...(await import('./docusign')),
    ...(await import('@/lib/esign/types')),
    ...(await import('@/lib/docusign')),
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('docusignProvider.create', () => {
  it('returns the envelope id as the external id, tagged with the provider', async () => {
    const { docusignProvider } = await loadAdapter()
    stubDocusign(new Response(JSON.stringify({ envelopeId: 'env-123' }), { status: 201 }))

    await expect(docusignProvider.create(ctx, adult)).resolves.toEqual({
      provider: 'docusign',
      externalId: 'env-123',
      signerCount: 1,
    })
  })

  it('reports a spent envelope allowance as AllowanceExhaustedError', async () => {
    const { docusignProvider, AllowanceExhaustedError } = await loadAdapter()
    stubDocusign(new Response(
      JSON.stringify({
        errorCode: 'ENVELOPE_ALLOWANCE_EXCEEDED',
        message: 'The envelope allowance for the account has been exceeded.',
      }),
      { status: 400 },
    ))

    const err = await docusignProvider.create(ctx, adult).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AllowanceExhaustedError)
    expect((err as InstanceType<typeof AllowanceExhaustedError>).provider).toBe('docusign')
    // The admin alert quotes this message, so it must still read as DocuSign's.
    expect((err as Error).message).toContain('DocuSign create adult envelope failed')
    expect((err as Error).message).toContain('ENVELOPE_ALLOWANCE_EXCEEDED')
  })

  it('passes any other DocuSign failure through with its error code', async () => {
    const { docusignProvider, AllowanceExhaustedError, DocusignApiError } = await loadAdapter()
    stubDocusign(new Response(
      JSON.stringify({ errorCode: 'TEMPLATE_ID_INVALID', message: 'Invalid template ID.' }),
      { status: 400 },
    ))

    const err = await docusignProvider.create(ctx, adult).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(AllowanceExhaustedError)
    expect(err).toBeInstanceOf(DocusignApiError)
    expect((err as InstanceType<typeof DocusignApiError>).errorCode).toBe('TEMPLATE_ID_INVALID')
    expect((err as InstanceType<typeof DocusignApiError>).status).toBe(400)
  })

  it('keeps the error readable when DocuSign answers with something that is not JSON', async () => {
    const { docusignProvider, DocusignApiError } = await loadAdapter()
    stubDocusign(new Response('<html>Bad Gateway</html>', { status: 502 }))

    const err = await docusignProvider.create(ctx, adult).catch((e: unknown) => e)
    // A 502 is DocuSign being down: the caller may fall back to Stellr signing.
    expect((err as Error).name).toBe('ProviderUnavailableError')
    expect((err as Error).message).toContain('Bad Gateway')
    const cause = (err as Error).cause
    expect(cause).toBeInstanceOf(DocusignApiError)
    expect((cause as InstanceType<typeof DocusignApiError>).errorCode).toBeNull()
  })
})
