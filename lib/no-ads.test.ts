import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { isNoAdsPath, isStudentForAds, noAdsScript, NO_ADS_COOKIE } from '@/lib/no-ads'
import { CONSENT_STORAGE_KEY, applyConsent } from '@/lib/consent'

// Privacy Policy §9.4: advertising never runs on student pages or in a
// student's browser, whatever the banner says.

const NOW = new Date('2026-10-02T12:00:00Z')

describe('isNoAdsPath', () => {
  it('covers registration, auth, the member platform and credentials', () => {
    for (const p of ['/register/co-sdc/individual', '/sign-up', '/sign-in/factor-one', '/home', '/community/events',
      '/account/onboarding', '/join', '/credentials/STL-2026-ABC', '/check-in/x', '/admin']) {
      expect(isNoAdsPath(p)).toBe(true)
    }
  })
  it('leaves marketing pages alone', () => {
    for (const p of ['/', '/educators', '/events/co-sdc', '/registered', '/homepage', '/privacy']) {
      expect(isNoAdsPath(p)).toBe(false)
    }
  })
})

describe('isStudentForAds', () => {
  it('treats under 18, the high school bracket and an unknown DOB as a student', () => {
    expect(isStudentForAds({ date_of_birth: '2012-01-01', age_bracket: null }, NOW)).toBe(true)
    expect(isStudentForAds({ date_of_birth: '2008-10-03', age_bracket: 'adult' }, NOW)).toBe(true)  // 17, birthday tomorrow
    expect(isStudentForAds({ date_of_birth: '2007-01-01', age_bracket: 'high_school' }, NOW)).toBe(true)
    expect(isStudentForAds({ date_of_birth: null, age_bracket: 'adult' }, NOW)).toBe(true)
    expect(isStudentForAds({ date_of_birth: '1985-06-01', age_bracket: 'adult' }, NOW)).toBe(false)
  })
})

describe('pre-GTM no-ads script', () => {
  type W = Window & { dataLayer: unknown[]; gtag: (...a: unknown[]) => void; __stellrNoAds?: boolean }
  const w = window as unknown as W

  function run() {
    w.dataLayer = []
    w.gtag = function () { w.dataLayer.push(arguments) } as W['gtag']
    delete w.__stellrNoAds
    new Function(`var CONSENT_KEY = ${JSON.stringify(CONSENT_STORAGE_KEY)}; var dataLayer = window.dataLayer; var gtag = window.gtag;${noAdsScript('app.example.org')}`)()
  }
  const calls = () => w.dataLayer.map((e) => (e && typeof e === 'object' && 'length' in (e as object) ? Array.from(e as ArrayLike<unknown>) : e))
  const grants = () => calls().filter((c) => Array.isArray(c) && c[0] === 'consent' && (c[2] as Record<string, string>).ad_storage === 'granted')

  // Each run() wraps history once, as the page does; unwrap between tests.
  const origPush = window.history.pushState
  const origReplace = window.history.replaceState
  afterEach(() => {
    window.history.pushState = origPush
    window.history.replaceState = origReplace
  })

  beforeEach(() => {
    window.localStorage.clear()
    document.cookie = `${NO_ADS_COOKIE}=; max-age=0; path=/`
    window.history.replaceState(null, '', '/')
  })

  it('replays a stored accept on a marketing page', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ ads: true }))
    run()
    expect(grants()).toHaveLength(1)
    expect(calls()).toContainEqual({ stellr_no_ads: false })
  })

  it('does not replay a stored accept on a registration page, and flags it', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ ads: true }))
    window.history.replaceState(null, '', '/register/co-sdc/individual')
    run()
    expect(grants()).toHaveLength(0)
    expect(calls()).toContainEqual({ stellr_no_ads: true })
    expect(calls()).toContainEqual(['set', { ads_data_redaction: true, allow_google_signals: false, allow_ad_personalization_signals: false }])
  })

  it('does not replay anywhere in a student-marked browser', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ ads: true }))
    document.cookie = `${NO_ADS_COOKIE}=1; path=/`
    run()
    expect(grants()).toHaveLength(0)
    expect(w.__stellrNoAds).toBe(true)
  })

  it('denies again on a client-side navigation into a student page, before GTM sees it', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ ads: true }))
    run()
    window.history.pushState(null, '', '/register/co-sdc/individual')
    const last = calls().slice(-3)
    expect(last).toContainEqual(['consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }])
    expect(last).toContainEqual({ stellr_no_ads: true })
    window.history.pushState(null, '', '/educators')
    expect(calls().slice(-2)).toContainEqual({ stellr_no_ads: false })
  })

  it('applyConsent refuses to grant while no-ads is active', () => {
    run()
    w.__stellrNoAds = true
    applyConsent(true)
    expect(grants()).toHaveLength(0)
  })
})
