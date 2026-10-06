// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROVIDER_STATE,
  decideProvider,
  effectiveCap,
  estimatedUsage,
  exhaustedUntil,
  periodStart,
  signerEmails,
  type ProviderState,
  type RoutingFacts,
} from './routing'

const now = new Date('2026-10-15T12:00:00Z')

const state = (over: Partial<ProviderState> = {}): ProviderState => ({
  ...DEFAULT_PROVIDER_STATE,
  mode: 'auto',
  ...over,
})

const facts = (over: Partial<RoutingFacts> = {}): RoutingFacts => ({
  type: 'minor',
  signerEmails: ['parent@example.test'],
  nativeAvailable: true,
  issuedThisPeriod: 0,
  issuedSinceSync: 0,
  now,
  ...over,
})

describe('decideProvider', () => {
  it('defaults to DocuSign: the shipped state never leaves it', () => {
    expect(decideProvider(DEFAULT_PROVIDER_STATE, facts())).toEqual({
      provider: 'docusign',
      reason: 'mode_docusign_only',
    })
  })

  it('sends the membership agreement to the native engine in every mode', () => {
    for (const mode of ['auto', 'docusign_only', 'overflow_only'] as const) {
      expect(decideProvider(state({ mode }), facts({ type: 'membership' })).provider).toBe('native')
    }
    // Even when native is not built: the caller must fail, not spend an envelope.
    expect(
      decideProvider(state(), facts({ type: 'membership', nativeAvailable: false })),
    ).toEqual({ provider: 'native', reason: 'membership' })
  })

  it('stays on DocuSign while the native engine is unavailable, whatever the state says', () => {
    const exhausted = state({ mode: 'overflow_only', exhaustedUntil: '2026-11-01T00:00:00Z' })
    expect(decideProvider(exhausted, facts({ nativeAvailable: false }))).toEqual({
      provider: 'docusign',
      reason: 'native_unavailable',
    })
  })

  it('uses DocuSign while usage is under the cap less the reserve', () => {
    expect(decideProvider(state(), facts({ issuedThisPeriod: 37 }))).toEqual({
      provider: 'docusign',
      reason: 'within_allowance',
    })
  })

  it('switches to native at the cap less the reserve', () => {
    // cap 40, reserve 2: the 39th and 40th envelopes are held back.
    expect(decideProvider(state(), facts({ issuedThisPeriod: 38 }))).toEqual({
      provider: 'native',
      reason: 'near_cap',
    })
  })

  it('switches to native while DocuSign is flagged exhausted, and back once the flag has passed', () => {
    expect(
      decideProvider(state({ exhaustedUntil: '2026-11-01T00:00:00Z' }), facts()),
    ).toEqual({ provider: 'native', reason: 'exhausted' })

    expect(
      decideProvider(state({ exhaustedUntil: '2026-10-01T00:00:00Z' }), facts()).provider,
    ).toBe('docusign')
  })

  it('counts envelopes DocuSign reports that this app never issued', () => {
    // 30 sent from DocuSign's web UI, 8 from here since that figure was read.
    const s = state({
      accountSent: 30,
      accountAllowed: 40,
      accountPeriodEnd: '2026-11-06T00:00:00Z',
      accountSyncedAt: '2026-10-14T00:00:00Z',
    })
    expect(decideProvider(s, facts({ issuedThisPeriod: 8, issuedSinceSync: 8 })).provider).toBe('native')
    expect(decideProvider(s, facts({ issuedThisPeriod: 7, issuedSinceSync: 7 })).provider).toBe('docusign')
  })

  it('ignores an account figure for a period that has already ended', () => {
    const s = state({ accountSent: 40, accountAllowed: 40, accountPeriodEnd: '2026-10-06T00:00:00Z' })
    expect(decideProvider(s, facts({ issuedThisPeriod: 3 })).provider).toBe('docusign')
  })

  it('keeps a type on DocuSign when it is not enabled for the native engine', () => {
    const s = state({ overflowTypes: ['minor', 'adult'], exhaustedUntil: '2026-11-01T00:00:00Z' })
    expect(decideProvider(s, facts({ type: 'mentor' }))).toEqual({
      provider: 'docusign',
      reason: 'type_not_enabled',
    })
    expect(
      decideProvider(state({ mode: 'overflow_only', overflowTypes: ['minor'] }), facts({ type: 'mentor' })).provider,
    ).toBe('docusign')
  })

  it('sends everything enabled to native in overflow_only mode', () => {
    expect(decideProvider(state({ mode: 'overflow_only' }), facts())).toEqual({
      provider: 'native',
      reason: 'mode_overflow_only',
    })
  })

  it('routes an allowlisted signer to native even in docusign_only mode (the production canary)', () => {
    const s = state({ mode: 'docusign_only', overflowAllowlist: ['  Parent@Example.test '] })
    expect(decideProvider(s, facts())).toEqual({ provider: 'native', reason: 'allowlist' })
    expect(decideProvider(s, facts({ signerEmails: ['someone@else.test'] })).provider).toBe('docusign')
  })
})

describe('effectiveCap and estimatedUsage', () => {
  it('is the configured cap less the reserve', () => {
    expect(effectiveCap(state())).toBe(38)
    expect(effectiveCap(state({ monthlyCap: 1, reserve: 5 }))).toBe(0)
  })

  it("ignores the allowance DocuSign's account endpoint reports (the web-UI allowance on an API plan)", () => {
    // Production, 6 Oct 2026: Starter reported 1 allowed against 40 API envelopes.
    expect(effectiveCap(state({ accountAllowed: 1 }))).toBe(38)
    expect(effectiveCap(state({ accountAllowed: 100 }))).toBe(38)
    const s = state({ accountSent: 0, accountAllowed: 1, accountPeriodEnd: '2026-11-06T00:00:00Z' })
    expect(decideProvider(s, facts({ issuedThisPeriod: 1 })).provider).toBe('docusign')
  })

  it('errs high: the larger of the account figure and our own count', () => {
    const s = state({ accountSent: 5, accountPeriodEnd: '2026-11-06T00:00:00Z' })
    expect(estimatedUsage(s, facts({ issuedThisPeriod: 12, issuedSinceSync: 1 }))).toBe(12)
    expect(estimatedUsage(s, facts({ issuedThisPeriod: 2, issuedSinceSync: 2 }))).toBe(7)
  })
})

describe('periodStart', () => {
  it('is one month before the period end DocuSign reports', () => {
    const s = state({ accountPeriodEnd: '2026-11-06T07:00:00Z' })
    expect(periodStart(s, now).toISOString()).toBe('2026-10-06T07:00:00.000Z')
  })

  it('falls back to the calendar month with no report, or a stale one', () => {
    expect(periodStart(state(), now).toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(
      periodStart(state({ accountPeriodEnd: '2026-10-06T07:00:00Z' }), now).toISOString(),
    ).toBe('2026-10-01T00:00:00.000Z')
  })
})

describe('exhaustedUntil', () => {
  it('lasts until the period end DocuSign reports', () => {
    const s = state({ accountPeriodEnd: '2026-11-06T07:00:00Z' })
    expect(exhaustedUntil(s, now).toISOString()).toBe('2026-11-06T07:00:00.000Z')
  })

  it('assumes the calendar month when DocuSign has reported nothing', () => {
    expect(exhaustedUntil(state(), now).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })

  it('backs off six hours, not a month, when refused just after a believed reset', () => {
    // We believed the allowance reset yesterday; DocuSign says otherwise.
    const s = state({ exhaustedUntil: '2026-10-14T12:00:00Z' })
    expect(exhaustedUntil(s, now).toISOString()).toBe('2026-10-15T18:00:00.000Z')
  })

  it('does not back off for a reset that passed long ago', () => {
    const s = state({ exhaustedUntil: '2026-09-01T00:00:00Z' })
    expect(exhaustedUntil(s, now).toISOString()).toBe('2026-11-01T00:00:00.000Z')
  })
})

describe('signerEmails', () => {
  it('lists guardian and student for a minor, normalised', () => {
    expect(
      signerEmails({
        type: 'minor',
        params: {
          minorFirstName: 'A', minorLastName: 'B', minorEmail: ' Kid@Example.test',
          guardianName: 'P', guardianEmail: 'Parent@Example.test ', eventTitle: 'E',
        },
      }),
    ).toEqual(['parent@example.test', 'kid@example.test'])
  })

  it('omits a student with no address', () => {
    expect(
      signerEmails({
        type: 'minor',
        params: {
          minorFirstName: 'A', minorLastName: 'B', minorEmail: '',
          guardianName: 'P', guardianEmail: 'parent@example.test', eventTitle: 'E',
        },
      }),
    ).toEqual(['parent@example.test'])
  })

  it('lists the signer for the single-signer agreements', () => {
    expect(
      signerEmails({ type: 'mentor', params: { firstName: 'A', lastName: 'B', email: 'M@Example.test', eventTitle: 'E' } }),
    ).toEqual(['m@example.test'])
  })
})
