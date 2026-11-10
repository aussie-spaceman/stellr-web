import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkRegistrationAge } from '@/lib/registration-eligibility'
import { STELLR_TENANT_ID, TENANT_MIN_PARTICIPANT_AGE } from '@/lib/tenancy/constants'
import { CANARY_TENANT } from '@/lib/testing/honeytokens'
import {
  assertEligible,
  assertRegistrable,
  TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT,
  eligibilityContextFromMirror,
  stellrContext,
  stellrUndatedContext,
  type MirrorEventForEligibility,
  type TenantEligibilityContext,
  type TenantForEligibility,
} from './eligibility'

// S5 A2: assertEligible() and the eligibility context. Library only: nothing
// imports it yet. The platform-owner context must reproduce today's Stellr
// check exactly; a tenant context enforces 14+ on the event's local start
// date and fails closed.

const UNAVAILABLE = "We can't confirm who can take part in this event right now, so we can't complete this registration. Please contact the event organiser."

function setNow(iso: string) {
  vi.setSystemTime(new Date(iso))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  setNow('2026-11-04T18:00:00Z')
})

afterEach(() => {
  vi.useRealTimers()
})

// The Canary seed event (lib/testing/two-tenant-seed.ts): local midnight
// 13 Mar 2027 in Sydney, which is still 12 Mar in UTC.
const CANARY_EVENT: MirrorEventForEligibility = {
  tenant_id: CANARY_TENANT.id,
  activity_type: 'live_event',
  starts_at: '2027-03-12T13:00:00.000Z',
  time_zone: CANARY_TENANT.time_zone,
  min_participant_age: 14,
}
const CANARY_ROW: TenantForEligibility = {
  id: CANARY_TENANT.id,
  is_platform_owner: false,
  min_participant_age: CANARY_TENANT.min_participant_age,
}
const STELLR_ROW: TenantForEligibility = { id: STELLR_TENANT_ID, is_platform_owner: true, min_participant_age: 0 }

function tenantCtx(over: Partial<TenantEligibilityContext> = {}): TenantEligibilityContext {
  return {
    kind: 'tenant',
    isPlatformOwner: false,
    tenantId: CANARY_TENANT.id,
    tenantMinAge: 14,
    eventMinAge: null,
    eventStartsAt: '2027-03-12T13:00:00.000Z',
    eventTimeZone: 'Australia/Sydney',
    activityType: 'live_event',
    ...over,
  }
}

describe('the platform minimum', () => {
  it('is the one tenancy constant, 14', () => {
    expect(TENANT_MIN_PARTICIPANT_AGE).toBe(14)
  })
})

describe('platform-owner context (Stellr): parity with checkRegistrationAge', () => {
  const dobs: unknown[] = [
    undefined, null, '', '   ', 42, 'abc', '12/01/2013', '2013-02-29', '2013-13-01', '2999-01-01', '1890-01-01',
    '2026-11-05', '2014-11-04', '2014-11-05', '2013-11-04', '2013-11-05', '2012-11-04', '2012-11-05',
    '2009-03-01', '2008-11-04', '2008-11-05', '1990-06-15', ' 2012-11-04 ', '2012-11-04T00:00:00Z',
  ]
  const eventDates: (string | null | undefined)[] = [undefined, null, '', 'TBC', '2026-11-06', '2027-01-15', '2027-03-04T09:00:00Z']
  const names: (string | undefined)[] = [undefined, 'Sam Lee']
  // A Denver evening that is already tomorrow in UTC, and a Denver morning.
  const nows = ['2026-11-05T05:30:00Z', '2026-11-04T15:00:00Z']

  it('returns exactly what today’s routes get, for every input', () => {
    for (const now of nows) {
      setNow(now)
      for (const dob of dobs) {
        for (const date of eventDates) {
          for (const name of names) {
            const expected = checkRegistrationAge(dob, name === undefined ? { eventDate: date ?? null } : { eventDate: date ?? null, name })
            const got = assertEligible(dob, stellrContext(date === undefined ? {} : { date }), name === undefined ? {} : { name })
            expect(got, JSON.stringify({ now, dob, date, name })).toEqual(expected)
          }
        }
      }
    }
    // Hundreds of expects: a loaded CI runner must not time this out.
  }, 20_000)

  it('admits under-13s and 13-year-olds with no floor, as Stellr does today', () => {
    expect(assertEligible('2014-11-05', stellrContext({ date: '2026-11-06' }))).toMatchObject({ ok: true, ageAtEvent: 12 })
    expect(assertEligible('2013-11-05', stellrContext({ date: '2026-11-06' }))).toMatchObject({ ok: true, ageAtEvent: 13 })
  })

  it('dates the context from a found Sanity event, undated when it has no date', () => {
    const owner = { kind: 'platform_owner', isPlatformOwner: true, tenantId: STELLR_TENANT_ID }
    expect(stellrContext({ date: '2026-11-06' })).toEqual({ ...owner, eventDate: '2026-11-06' })
    expect(stellrContext({ date: null })).toEqual({ ...owner, eventDate: null })
    expect(stellrContext({})).toEqual({ ...owner, eventDate: null })
  })

  it('refuses a missing event: an unknown event is never Stellr’s no-floor context', () => {
    // @ts-expect-error a null event does not type-check; this is what an untyped caller could still pass.
    const fromNull = stellrContext(null)
    // @ts-expect-error as above.
    const fromUndefined = stellrContext(undefined)
    for (const ctx of [fromNull, fromUndefined]) {
      expect(ctx).toEqual({ kind: 'unresolved', isPlatformOwner: false, tenantId: null, detail: 'event_missing' })
      // A 12-year-old, who a real Stellr event admits with a parent.
      expect(assertEligible('2014-06-01', ctx)).toEqual({
        ok: false, reason: 'eligibility_unavailable', detail: 'event_missing', error: UNAVAILABLE,
      })
    }
  })
})

describe('stellrUndatedContext (Stellr writers with no event date)', () => {
  it('gives today’s date-only check when the tenant row is positively Stellr', () => {
    const ctx = stellrUndatedContext(STELLR_ROW)
    expect(ctx).toEqual({ kind: 'platform_owner', isPlatformOwner: true, tenantId: STELLR_TENANT_ID, eventDate: null })
    for (const dob of [undefined, '', 'abc', '2999-01-01', '2014-06-01', '1990-06-15']) {
      expect(assertEligible(dob, ctx), String(dob)).toEqual(checkRegistrationAge(dob))
    }
  })

  it('refuses when the tenant could not be read', () => {
    for (const row of [null, undefined]) {
      const ctx = stellrUndatedContext(row)
      expect(ctx).toEqual({ kind: 'unresolved', isPlatformOwner: false, tenantId: null, detail: 'tenant_missing' })
      expect(assertEligible('2014-06-01', ctx)).toMatchObject({ ok: false, reason: 'eligibility_unavailable' })
    }
  })

  it('refuses any row that is not both Stellr’s id and flagged as the owner', () => {
    for (const row of [
      CANARY_ROW,
      { ...CANARY_ROW, is_platform_owner: true },
      { ...STELLR_ROW, is_platform_owner: false },
      { ...STELLR_ROW, is_platform_owner: 'true' as unknown as boolean },
    ]) {
      const ctx = stellrUndatedContext(row)
      expect(ctx, JSON.stringify(row)).toEqual({ kind: 'unresolved', isPlatformOwner: false, tenantId: row.id, detail: 'tenant_mismatch' })
      expect(assertEligible('2014-06-01', ctx)).toMatchObject({ ok: false, reason: 'eligibility_unavailable' })
    }
  })
})

describe('tenant context', () => {
  it('refuses a 13-year-old and admits a 14-year-old on the event date', () => {
    const ctx = tenantCtx({ eventStartsAt: '2026-12-01T13:00:00.000Z' }) // 2 Dec in Sydney
    expect(assertEligible('2012-12-03', ctx)).toEqual({
      ok: false, reason: 'under_minimum_age', error: 'You must be 14 or older on the day of the event to take part.',
    })
    expect(assertEligible('2012-12-02', ctx)).toEqual({
      ok: true, dateOfBirth: '2012-12-02', ageAtEvent: 14, ageToday: 13, isMinor: true,
    })
  })

  it('names the person in the refusal', () => {
    expect(assertEligible('2013-06-01', tenantCtx(), { name: 'Sam Lee' })).toMatchObject({
      reason: 'under_minimum_age', error: 'Sam Lee must be 14 or older on the day of the event to take part.',
    })
  })

  it('takes age on the event’s local date: the Sydney boundary on the Canary seed event', () => {
    const ctx = eligibilityContextFromMirror(CANARY_EVENT, CANARY_ROW)
    // 14 on 13 Mar (Sydney), though only 13 on 12 Mar (UTC).
    expect(assertEligible('2013-03-13', ctx)).toMatchObject({ ok: true, ageAtEvent: 14 })
    expect(assertEligible('2013-03-14', ctx)).toMatchObject({ ok: false, reason: 'under_minimum_age' })
  })

  it('refuses an under-13 today, even if they would be 14 by a far-future event', () => {
    const in2028 = tenantCtx({ eventStartsAt: '2028-05-31T14:00:00.000Z' }) // 1 Jun 2028 in Sydney
    // 12 today, 14 on the day.
    expect(assertEligible('2014-01-01', in2028)).toEqual({
      ok: false, reason: 'under_minimum_age', error: 'You must be 13 or older to register for this event.',
    })
    expect(assertEligible('2014-01-01', in2028, { name: 'Sam Lee' })).toEqual({
      ok: false, reason: 'under_minimum_age', error: 'Sam Lee must be 13 or older to register for this event.',
    })
    // 6 today, 14 on the day.
    expect(assertEligible('2020-01-01', tenantCtx({ eventStartsAt: '2034-05-31T14:00:00.000Z' }))).toMatchObject({
      ok: false, reason: 'under_minimum_age',
    })
  })

  it('admits someone exactly 13 today who is 14 on the day, taking today in the event’s zone', () => {
    // 10 am 5 Nov in Sydney, still 4 Nov in UTC and Denver.
    setNow('2026-11-04T23:00:00Z')
    const ctx = tenantCtx({ eventStartsAt: '2028-05-31T14:00:00.000Z' })
    expect(assertEligible('2013-11-05', ctx)).toEqual({
      ok: true, dateOfBirth: '2013-11-05', ageAtEvent: 14, ageToday: 13, isMinor: true,
    })
    // One day younger: still 12 today, though 14 on the day.
    expect(assertEligible('2013-11-06', ctx)).toMatchObject({ ok: false, reason: 'under_minimum_age', error: expect.stringContaining('13 or older') })
  })

  it('does not apply the under-13 rule to the platform owner', () => {
    expect(assertEligible('2014-01-01', stellrContext({ date: '2028-06-01' }))).toMatchObject({ ok: true, ageToday: 12, ageAtEvent: 14 })
  })

  it('fails closed on a missing or unreadable date of birth', () => {
    const ctx = tenantCtx()
    for (const v of [undefined, null, '', '   ', 7, {}]) {
      expect(assertEligible(v, ctx)).toMatchObject({ ok: false, reason: 'dob_missing' })
    }
    for (const v of ['abc', '2013-02-29', '2013-13-01', '2999-01-01', '1890-01-01', '0211-05-04']) {
      expect(assertEligible(v, ctx), v).toMatchObject({ ok: false, reason: 'dob_invalid' })
    }
  })

  it('treats a date after today in the event’s zone as invalid', () => {
    // 10 am 5 Nov in Sydney, still 4 Nov in UTC and Denver.
    setNow('2026-11-04T23:00:00Z')
    expect(assertEligible('2026-11-05', tenantCtx())).toMatchObject({ ok: false, reason: 'dob_invalid' })
    // 6 Nov does not exist yet anywhere.
    expect(assertEligible('2026-11-06', tenantCtx())).toMatchObject({ ok: false, reason: 'dob_invalid' })
  })

  it('lets an event minimum raise the floor but never lower it', () => {
    expect(assertEligible('2012-01-01', tenantCtx({ eventMinAge: 16 }))).toMatchObject({
      ok: false, reason: 'under_minimum_age', error: 'You must be 16 or older on the day of the event to take part.',
    })
    expect(assertEligible('2011-01-01', tenantCtx({ eventMinAge: 16 }))).toMatchObject({ ok: true, ageAtEvent: 16 })
    expect(assertEligible('2014-01-01', tenantCtx({ eventMinAge: 10 }))).toMatchObject({
      ok: false, reason: 'under_minimum_age', error: 'You must be 14 or older on the day of the event to take part.',
    })
    expect(assertEligible('2014-01-01', tenantCtx({ eventMinAge: 0 }))).toMatchObject({ reason: 'under_minimum_age' })
  })

  it('lets a tenant minimum raise the floor but never lower it', () => {
    expect(assertEligible('2010-06-01', tenantCtx({ tenantMinAge: 18 }))).toMatchObject({
      ok: false, error: 'You must be 18 or older on the day of the event to take part.',
    })
    expect(assertEligible('2013-06-01', tenantCtx({ tenantMinAge: 0 }))).toMatchObject({ reason: 'under_minimum_age' })
    // The highest of the three wins.
    expect(assertEligible('2010-06-01', tenantCtx({ tenantMinAge: 15, eventMinAge: 17 }))).toMatchObject({
      error: 'You must be 17 or older on the day of the event to take part.',
    })
    expect(assertEligible('2010-06-01', tenantCtx({ tenantMinAge: 17, eventMinAge: 15 }))).toMatchObject({
      error: 'You must be 17 or older on the day of the event to take part.',
    })
  })

  it('takes an undated campaign’s age on today in the event’s zone', () => {
    // 10 am 5 Nov in Sydney: someone born 5 Nov 2012 is 14 there, 13 in UTC.
    setNow('2026-11-04T23:00:00Z')
    const ctx = tenantCtx({ eventStartsAt: null, activityType: 'campaign' })
    expect(assertEligible('2012-11-05', ctx)).toEqual({
      ok: true, dateOfBirth: '2012-11-05', ageAtEvent: 14, ageToday: 14, isMinor: true,
    })
    expect(assertEligible('2012-11-06', ctx)).toMatchObject({ ok: false, reason: 'under_minimum_age' })
  })

  it('fails closed when a live event has no start date, or an unreadable one', () => {
    for (const activityType of ['live_event', null, 'something_else']) {
      expect(assertEligible('2000-01-01', tenantCtx({ eventStartsAt: null, activityType }))).toEqual({
        ok: false, reason: 'eligibility_unavailable', detail: 'start_date_missing', error: UNAVAILABLE,
      })
    }
    expect(assertEligible('2000-01-01', tenantCtx({ eventStartsAt: 'soon' }))).toMatchObject({
      reason: 'eligibility_unavailable', detail: 'start_date_invalid',
    })
  })

  it('fails closed on an unknown or missing time zone', () => {
    for (const eventTimeZone of ['Mars/Olympus_Mons', '', null]) {
      expect(assertEligible('2000-01-01', tenantCtx({ eventTimeZone }))).toEqual({
        ok: false, reason: 'eligibility_unavailable', detail: 'time_zone_invalid', error: UNAVAILABLE,
      })
    }
  })

  it('fails closed with no tenant minimum (the tenant row was not found)', () => {
    expect(assertEligible('2000-01-01', tenantCtx({ tenantMinAge: null }))).toMatchObject({
      ok: false, reason: 'eligibility_unavailable', detail: 'tenant_missing',
    })
  })

  it('fails closed on an unusable minimum age', () => {
    for (const over of [
      { tenantMinAge: -1 }, { tenantMinAge: 14.5 }, { tenantMinAge: Number.NaN },
      { eventMinAge: -3 }, { eventMinAge: Number.POSITIVE_INFINITY }, { eventMinAge: '16' as unknown as number },
    ]) {
      expect(assertEligible('2000-01-01', tenantCtx(over)), JSON.stringify(over)).toMatchObject({
        ok: false, reason: 'eligibility_unavailable', detail: 'min_age_invalid',
      })
    }
  })

  it('carries no date of birth or name in an unavailable refusal', () => {
    const r = assertEligible('2000-01-01', tenantCtx({ eventTimeZone: null }), { name: 'Sam Lee' })
    expect(JSON.stringify(r)).not.toMatch(/2000|Sam/)
  })

  it('refuses everyone for an unresolved context', () => {
    expect(assertEligible('2000-01-01', { kind: 'unresolved', isPlatformOwner: false, tenantId: null, detail: 'tenant_mismatch' })).toEqual({
      ok: false, reason: 'eligibility_unavailable', detail: 'tenant_mismatch', error: UNAVAILABLE,
    })
  })
})

describe('assertRegistrable: the register routes’ consent rule (S5 A7)', () => {
  const CONSENT = 'You must be 18 or older to register for this event online. Please contact the event organiser.'
  // Event 2 Dec 2026 in Sydney; "today" is 4 Nov 2026.
  const ctx = tenantCtx({ eventStartsAt: '2026-12-01T13:00:00.000Z' })

  it('on a tenant’s event, refuses anyone under 18 the floor admits, today or on the day', () => {
    expect(assertRegistrable('2012-12-02', ctx)).toEqual({ ok: false, reason: 'under_minimum_age', error: CONSENT })
    expect(assertRegistrable('2010-06-01', ctx)).toEqual({ ok: false, reason: 'under_minimum_age', error: CONSENT })
    // 18 on the day but 17 today: still a minor now, and refused.
    expect(assertRegistrable('2008-11-20', ctx)).toEqual({ ok: false, reason: 'under_minimum_age', error: CONSENT })
    expect(assertRegistrable('2010-06-01', ctx, { name: 'Sam Lee' })).toMatchObject({
      error: 'Sam Lee must be 18 or older to register for this event online. Please contact the event organiser.',
    })
  })

  it('on a tenant’s event, admits an adult, and gives the floor’s answer under it', () => {
    expect(assertRegistrable('2008-11-04', ctx)).toEqual(assertEligible('2008-11-04', ctx))
    expect(assertRegistrable('2008-11-04', ctx)).toMatchObject({ ok: true, isMinor: false })
    expect(assertRegistrable('2012-12-03', ctx)).toEqual(assertEligible('2012-12-03', ctx))
    expect(assertRegistrable('', ctx)).toEqual(assertEligible('', ctx))
  })

  it('on Stellr’s events, is assertEligible: 12-, 13- and 15-year-olds are admitted as before', () => {
    const stellr = stellrContext({ date: '2026-12-02' })
    for (const dob of ['2014-06-01', '2013-06-01', '2011-06-01', '1990-01-01', '', '2999-01-01']) {
      expect(assertRegistrable(dob, stellr)).toEqual(assertEligible(dob, stellr))
    }
    expect(assertRegistrable('2011-06-01', stellr)).toMatchObject({ ok: true, isMinor: true })
  })

  it('the age is the one the rule names', () => {
    expect(TENANT_MIN_AGE_WITHOUT_GUARDIAN_CONSENT).toBe(18)
  })

  describe('S5 wave 6: guardian consent', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('flag off: guardianConsent changes nothing, every minor is refused', () => {
      expect(assertRegistrable('2010-06-01', ctx, { guardianConsent: true })).toEqual({ ok: false, reason: 'under_minimum_age', error: CONSENT })
    })

    it('flag on, a route that can take a guardian: a 14-17-year-old is admitted, marked guardianConsentRequired', () => {
      vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
      expect(assertRegistrable('2010-06-01', ctx, { guardianConsent: true })).toEqual({ ...assertEligible('2010-06-01', ctx), guardianConsentRequired: true })
      // 18 on the day but 17 today: still a minor now, so consent is required.
      expect(assertRegistrable('2008-11-20', ctx, { guardianConsent: true })).toMatchObject({ ok: true, guardianConsentRequired: true })
    })

    it('flag on, but a route that cannot take a guardian (group, group-join): still refused', () => {
      vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
      expect(assertRegistrable('2010-06-01', ctx)).toEqual({ ok: false, reason: 'under_minimum_age', error: CONSENT })
    })

    it('flag on: the floor still refuses a 13-year-old on the day, and an adult needs no consent', () => {
      vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
      expect(assertRegistrable('2012-12-03', ctx, { guardianConsent: true })).toEqual(assertEligible('2012-12-03', ctx))
      expect(assertRegistrable('2012-12-03', ctx, { guardianConsent: true })).toMatchObject({ ok: false, reason: 'under_minimum_age' })
      expect(assertRegistrable('2008-11-04', ctx, { guardianConsent: true })).not.toHaveProperty('guardianConsentRequired')
    })

    it('only exactly "true" turns it on', () => {
      vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'TRUE')
      expect(assertRegistrable('2010-06-01', ctx, { guardianConsent: true })).toMatchObject({ ok: false })
    })

    it('flag on: Stellr’s events are unchanged', () => {
      vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', 'true')
      const stellr = stellrContext({ date: '2026-12-02' })
      expect(assertRegistrable('2011-06-01', stellr, { guardianConsent: true })).toEqual(assertEligible('2011-06-01', stellr))
    })
  })
})

describe('eligibilityContextFromMirror', () => {
  it('builds a tenant context from a non-owner event and its tenant', () => {
    expect(eligibilityContextFromMirror(CANARY_EVENT, CANARY_ROW)).toEqual({
      kind: 'tenant',
      isPlatformOwner: false,
      tenantId: CANARY_TENANT.id,
      tenantMinAge: 14,
      eventMinAge: 14,
      eventStartsAt: '2027-03-12T13:00:00.000Z',
      eventTimeZone: 'Australia/Sydney',
      activityType: 'live_event',
    })
  })

  it('fails closed with no tenant row, or a tenant row for another tenant', () => {
    expect(eligibilityContextFromMirror(CANARY_EVENT, null)).toEqual({
      kind: 'unresolved', isPlatformOwner: false, tenantId: CANARY_TENANT.id, detail: 'tenant_missing',
    })
    expect(eligibilityContextFromMirror(CANARY_EVENT, undefined)).toMatchObject({ kind: 'unresolved', detail: 'tenant_missing' })
    expect(eligibilityContextFromMirror(CANARY_EVENT, STELLR_ROW)).toEqual({
      kind: 'unresolved', isPlatformOwner: false, tenantId: CANARY_TENANT.id, detail: 'tenant_mismatch',
    })
    expect(assertEligible('2000-01-01', eligibilityContextFromMirror(CANARY_EVENT, null))).toMatchObject({
      ok: false, reason: 'eligibility_unavailable',
    })
  })

  it('fails closed with no event, whatever the tenant row says', () => {
    for (const event of [null, undefined]) {
      for (const row of [null, undefined, CANARY_ROW, STELLR_ROW]) {
        const ctx = eligibilityContextFromMirror(event, row)
        expect(ctx).toEqual({ kind: 'unresolved', isPlatformOwner: false, tenantId: row?.id ?? null, detail: 'event_missing' })
        expect(assertEligible('2014-06-01', ctx)).toMatchObject({ ok: false, reason: 'eligibility_unavailable', detail: 'event_missing' })
      }
    }
  })

  it('never gives the no-floor context to a flagged row that is not Stellr’s', () => {
    const flagged = { ...CANARY_ROW, is_platform_owner: true }
    const ctx = eligibilityContextFromMirror(CANARY_EVENT, flagged)
    expect(ctx).toEqual({ kind: 'unresolved', isPlatformOwner: false, tenantId: CANARY_TENANT.id, detail: 'tenant_mismatch' })
    expect(assertEligible('2014-06-01', ctx)).toMatchObject({ ok: false, reason: 'eligibility_unavailable' })
  })

  it('refuses a Stellr row that has lost its owner flag', () => {
    const stellrEvent = { ...CANARY_EVENT, tenant_id: STELLR_TENANT_ID }
    for (const is_platform_owner of [false, 'true' as unknown as boolean]) {
      expect(eligibilityContextFromMirror(stellrEvent, { ...STELLR_ROW, is_platform_owner })).toEqual({
        kind: 'unresolved', isPlatformOwner: false, tenantId: STELLR_TENANT_ID, detail: 'tenant_mismatch',
      })
    }
  })

  it('treats only a strict true as the owner flag', () => {
    // Not a boolean: a tenant event (14+), never the no-floor branch.
    const ctx = eligibilityContextFromMirror(CANARY_EVENT, { ...CANARY_ROW, is_platform_owner: 'true' as unknown as boolean })
    expect(ctx).toMatchObject({ kind: 'tenant', isPlatformOwner: false })
    expect(eligibilityContextFromMirror(CANARY_EVENT, { ...CANARY_ROW, is_platform_owner: 1 as unknown as boolean })).toMatchObject({ kind: 'tenant' })
  })

  it('carries a missing tenant minimum through, so the check refuses', () => {
    const ctx = eligibilityContextFromMirror(CANARY_EVENT, { ...CANARY_ROW, min_participant_age: null })
    expect(ctx).toMatchObject({ kind: 'tenant', tenantMinAge: null })
    expect(assertEligible('2000-01-01', ctx)).toMatchObject({ detail: 'tenant_missing' })
  })

  it('gives a platform-owner event the Stellr context, dated from starts_at in its zone', () => {
    // The Stellr fixture event: local midnight 12 Mar 2027 in Denver.
    const stellrEvent: MirrorEventForEligibility = {
      tenant_id: STELLR_TENANT_ID,
      activity_type: 'live_event',
      starts_at: '2027-03-12T07:00:00.000Z',
      time_zone: 'America/Denver',
      min_participant_age: null,
    }
    const ctx = eligibilityContextFromMirror(stellrEvent, STELLR_ROW)
    expect(ctx).toEqual(stellrContext({ date: '2027-03-12' }))
    // Stellr's rules: a 12-year-old is admitted.
    expect(assertEligible('2014-06-01', ctx)).toMatchObject({ ok: true, ageAtEvent: 12 })
    // An undated Stellr campaign.
    expect(eligibilityContextFromMirror({ ...stellrEvent, starts_at: null, activity_type: 'campaign' }, STELLR_ROW)).toEqual(stellrContext({ date: null }))
  })

  it('fails closed on a platform-owner event whose zone or start cannot be read', () => {
    const base: MirrorEventForEligibility = {
      tenant_id: STELLR_TENANT_ID, activity_type: 'live_event', starts_at: '2027-03-12T07:00:00.000Z', time_zone: 'Nowhere/Land', min_participant_age: null,
    }
    expect(eligibilityContextFromMirror(base, STELLR_ROW)).toEqual({
      kind: 'unresolved', isPlatformOwner: false, tenantId: STELLR_TENANT_ID, detail: 'time_zone_invalid',
    })
    expect(eligibilityContextFromMirror({ ...base, time_zone: null }, STELLR_ROW)).toMatchObject({ detail: 'time_zone_invalid' })
    expect(eligibilityContextFromMirror({ ...base, time_zone: 'America/Denver', starts_at: 'nope' }, STELLR_ROW)).toEqual({
      kind: 'unresolved', isPlatformOwner: false, tenantId: STELLR_TENANT_ID, detail: 'start_date_invalid',
    })
  })
})
