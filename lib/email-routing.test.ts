import { afterEach, describe, expect, it, vi } from 'vitest'

// DEV_MAIL_SAFELIST is read at module load, so each case re-imports through a
// fresh registry rather than mutating an evaluated constant.
async function load(appEnv?: string, safelist?: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', appEnv ?? '')
  if (safelist !== undefined) vi.stubEnv('DEV_EMAIL_SAFELIST', safelist)
  return import('./email')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('routeRecipients in production', () => {
  it('delivers to the real recipient untouched', async () => {
    const { routeRecipients } = await load('prod')
    expect(routeRecipients('teacher@school.org')).toEqual({
      to: 'teacher@school.org',
      cc: [],
      subjectPrefix: '',
    })
  })

  it('preserves cc', async () => {
    const { routeRecipients } = await load('prod')
    const r = routeRecipients('teacher@school.org', ['head@school.org'])
    expect(r.to).toBe('teacher@school.org')
    expect(r.cc).toEqual(['head@school.org'])
  })
})

describe('routeRecipients outside production', () => {
  it('redirects to the safelist address', async () => {
    const { routeRecipients } = await load('dev')
    expect(routeRecipients('teacher@school.org').to).toBe('hello@stellreducation.org')
  })

  it('records the intended recipient in the subject', async () => {
    const { routeRecipients } = await load('dev')
    expect(routeRecipients('teacher@school.org').subjectPrefix).toBe(
      '[dev → teacher@school.org] ',
    )
  })

  it('drops cc — a cc’d address is a real person too', async () => {
    const { routeRecipients } = await load('dev')
    const r = routeRecipients('teacher@school.org', ['head@school.org'])
    expect(r.cc).toEqual([])
    expect(r.subjectPrefix).toContain('head@school.org')
  })

  it('honours an explicit safelist override', async () => {
    const { routeRecipients } = await load('dev', 'qa@stellreducation.org')
    expect(routeRecipients('teacher@school.org').to).toBe('qa@stellreducation.org')
  })

  it('sends nothing when the safelist is blanked', async () => {
    const { routeRecipients } = await load('dev', '')
    expect(routeRecipients('teacher@school.org').to).toBeNull()
  })

  it('treats whitespace as blank rather than as an address', async () => {
    const { routeRecipients } = await load('dev', '   ')
    expect(routeRecipients('teacher@school.org').to).toBeNull()
  })

  // The whole point of the fail-safe default: a half-configured environment
  // must not reach real people.
  it('redirects when APP_ENV is unset entirely', async () => {
    const { routeRecipients } = await load(undefined)
    expect(routeRecipients('teacher@school.org').to).toBe('hello@stellreducation.org')
  })

  it('treats a typo’d APP_ENV as non-production', async () => {
    const { routeRecipients } = await load('production')
    expect(routeRecipients('teacher@school.org').to).toBe('hello@stellreducation.org')
  })
})
