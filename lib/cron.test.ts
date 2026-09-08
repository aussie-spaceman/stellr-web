import { afterEach, describe, expect, it, vi } from 'vitest'

// APP_ENV is read once at module load, so each case re-imports through a fresh
// module registry rather than mutating an already-evaluated constant.
async function load(
  appEnv: string | undefined,
  cronSecret = 'secret',
  vercelEnv: string | undefined = undefined,
) {
  vi.resetModules()
  if (appEnv === undefined) vi.stubEnv('NEXT_PUBLIC_APP_ENV', '')
  else vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv)
  vi.stubEnv('VERCEL_ENV', vercelEnv ?? '')
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

// The other question lib/env.ts answers: which Vercel deployment *target* this
// is. Deliberately a separate signal from APP_ENV — see that module's header.
describe('vercelTarget', () => {
  it('reports the platform-set target', async () => {
    const { vercelTarget, isProductionDeployment } = await load('prod', 'secret', 'production')
    expect(vercelTarget()).toBe('production')
    expect(isProductionDeployment()).toBe(true)
  })

  it('reports preview deployments as preview', async () => {
    const { vercelTarget, isProductionDeployment } = await load('dev', 'secret', 'preview')
    expect(vercelTarget()).toBe('preview')
    expect(isProductionDeployment()).toBe(false)
  })

  it('reports an unset VERCEL_ENV as development — running off Vercel', async () => {
    const { vercelTarget, isProductionDeployment } = await load('dev')
    expect(vercelTarget()).toBe('development')
    expect(isProductionDeployment()).toBe(false)
  })
})

// The whole reason the two signals are not collapsed into one. The planned dev
// Vercel project tracks its own branch, so VERCEL_ENV=production there while
// APP_ENV says dev. If the cron guard read VERCEL_ENV, all twelve crons would
// run on that project and mail real members a second time every day.
describe('the two signals diverge on the dev Vercel project', () => {
  it('is a production deployment target that is not our production environment', async () => {
    const { isProd, isProductionDeployment, guardCron } = await load('dev', 'secret', 'production')
    expect(isProductionDeployment()).toBe(true)
    expect(isProd()).toBe(false)
    const res = guardCron(req('Bearer secret'))
    expect(res?.status).toBe(200)
    await expect(res?.json()).resolves.toEqual({ skipped: true, reason: 'APP_ENV=dev' })
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
