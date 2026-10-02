import { ageOn, isValidDob } from '@/lib/age'

// ── No advertising for students (Privacy Policy §9.4, 2 Oct 2026) ────────────
// Advertising tags never run on registration pages, the participant platform,
// or for a signed-in student — whatever the cookie banner says. For a child
// under 13 an "Accept" is not consent at all.
//
// Enforced in two layers, because the ad tags themselves live in the GTM
// container, not this repo:
//   1. Here: on a no-ads page (or a browser marked as a student's), Consent
//      Mode is forced to denied and stays there, a stored "Accept all" is not
//      replayed, Google signals and ad personalization are switched off, and
//      `stellr_no_ads: true` is pushed to the dataLayer before GTM loads.
//   2. In GTM: every advertising tag (Google Ads, Meta, LinkedIn, Apollo) has a
//      blocking trigger exception on `stellr_no_ads equals true`. Without it a
//      tag in advanced Consent Mode still sends cookieless pings, so this half
//      is what makes "never loaded" true. Setup: docs/RUNBOOK-no-ads-students.md.

/** Set on any browser where a student (or a member whose age is unknown) has signed in. */
export const NO_ADS_COOKIE = 'stellr_no_ads'

/** Registration, sign-in/up, the member platform, credential pages, check-in, admin. */
export const NO_ADS_PATH_SOURCE =
  '^/(register|sign-in|sign-up|home|community|account|join|campaigns|credentials|check-in|admin|studio)(/|$)'

const NO_ADS_PATH = new RegExp(NO_ADS_PATH_SOURCE)

export function isNoAdsPath(pathname: string): boolean {
  return NO_ADS_PATH.test(pathname)
}

/**
 * Whether a signed-in member is treated as a student for advertising. Errs
 * towards yes: anyone under 18 or in the high school bracket, and anyone whose
 * date of birth we do not have — we cannot rule out a child.
 */
export function isStudentForAds(
  m: { date_of_birth: string | null; age_bracket: string | null },
  on = new Date(),
): boolean {
  if (m.age_bracket === 'high_school') return true
  if (!isValidDob(m.date_of_birth)) return true
  return ageOn(m.date_of_birth, on) < 18
}

/** Browser-side: is advertising off for this page view? */
export function noAdsActive(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { __stellrNoAds?: boolean }
  if (typeof w.__stellrNoAds === 'boolean') return w.__stellrNoAds
  return isNoAdsPath(window.location.pathname) || hasNoAdsCookie()
}

export function hasNoAdsCookie(): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${NO_ADS_COOKIE}=`))
}

/**
 * Inline, pre-GTM. Decides no-ads from the path, the member-app host and the
 * student cookie, and re-decides on every client-side navigation by wrapping
 * history.pushState/replaceState. GTM installs its own history listener after
 * this script, so its wrapper calls ours first: the consent update and the
 * `stellr_no_ads` flag land before GTM sees the route change.
 */
export function noAdsScript(appHost: string): string {
  return `
  var NO_ADS_PATH = new RegExp(${JSON.stringify(NO_ADS_PATH_SOURCE)});
  var APP_HOST = ${JSON.stringify(appHost)};
  function savedAds() {
    try {
      var raw = window.localStorage.getItem(CONSENT_KEY);
      var saved = raw && JSON.parse(raw);
      return !!(saved && saved.ads === true);
    } catch (e) { return false; }
  }
  function isNoAds() {
    if (window.location.host === APP_HOST) return true;
    if (NO_ADS_PATH.test(window.location.pathname)) return true;
    return document.cookie.split(';').some(function (c) { return c.trim().indexOf(${JSON.stringify(NO_ADS_COOKIE + '=')}) === 0; });
  }
  function applyNoAds(first) {
    var noAds = isNoAds();
    if (!first && noAds === window.__stellrNoAds) return;
    window.__stellrNoAds = noAds;
    if (noAds) {
      if (!first) {
        gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      }
      gtag('set', { ads_data_redaction: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    } else if (savedAds()) {
      gtag('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
      if (!first) gtag('set', { ads_data_redaction: false, allow_google_signals: true, allow_ad_personalization_signals: true });
    }
    dataLayer.push({ stellr_no_ads: noAds });
  }
  applyNoAds(true);
  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function () {
      var r = orig.apply(this, arguments);
      try { applyNoAds(false); } catch (e) {}
      return r;
    };
  });
  window.addEventListener('popstate', function () { try { applyNoAds(false); } catch (e) {} });
`
}
