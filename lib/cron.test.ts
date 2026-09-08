import { afterEach, describe, expect, it, vi } from 'vitest'

// APP_ENV is read once at module load, so each case re-imports through a fresh
// module registry rather than mutating an already-evaluated constant.
async function load(appEnv: string | undefined, cronSecret = 'secret') {
  vi.resetModules()
  if (appEnv === undefined) vi.stubEnv('NEXT_PUBLIC_APP_ENV', '')
  else vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv)
  vi.stubEnv('CRON_SECRET', cronSecret)
  return {
    ...(await import('./cron')),
    ...(await import('./env')),
  }
}

const req = (auth?: string) =>
  new Request('https://example.test/api/cron/campaigns', {
    headers: auth ? { authorization: auth } : {},
  })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('APP_ENV', () => {
  it('defaults to dev when unset', async () => {
    const { appEnv, isProd } = await load(undefined)
    expect(appEnv()).toBe('dev')
    expect(isProd()).toBe(false)
  })

  it('treats any value other than prod as dev', async () => {
    // A typo'd or half-configured value must not read as production.
    const { appEnv } = await load('production')
    expect(appEnv()).toBe('dev')
  })

  it('is prod only for exactly "prod"', async () => {
    const { appEnv, isProd } = await load('prod')
    expect(appEnv()).toBe('prod')
    expect(isProd()).toBe(true)
  })
})

describe('assertProd', () => {
  it('throws outside production', async () => {
    const { assertProd } = await load('dev')
    expect(() => assertProd('Ordering a background check')).toThrow(/production-only/)
  })

  it('passes in production', async () => {
    const { assertProd } = await load('prod')
    expect(() => assertProd('Ordering a background check')).not.toThrow()
  })
})

describe('guardCron', () => {
  it('rejects a missing or wrong secret before revealing the environment', async () => {
    const { guardCron } = await load('prod')
    const res = guardCron(req('Bearer wrong'))
    expect(res?.status).toBe(401)
    await expect(res?.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('declines to run in dev even with the correct secret', async () => {
    const { guardCron } = await load('dev')
    const res = guardCron(req('Bearer secret'))
    expect(res).not.toBeNull()
    // 200, so Vercel does not record a daily failing job.
    expect(res?.status).toBe(200)
    await expect(res?.json()).resolves.toEqual({ skipped: true, reason: 'APP_ENV=dev' })
  })

  it('lets an authorised request through in production', async () => {
    const { guardCron } = await load('prod')
    expect(guardCron(req('Bearer secret'))).toBeNull()
  })

  it('declines in dev when APP_ENV is unset — the fail-safe default', async () => {
    const { guardCron } = await load(undefined)
    expect(guardCron(req('Bearer secret'))?.status).toBe(200)
  })
})
