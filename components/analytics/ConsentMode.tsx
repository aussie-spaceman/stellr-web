import { CONSENT_STORAGE_KEY, STRICT_REGIONS } from '@/lib/consent'
import { APP_HOST } from '@/lib/env'
import { noAdsScript } from '@/lib/no-ads'

/**
 * Google Consent Mode v2 defaults.
 *
 * This MUST execute before the GTM container loads, or tags fire once in an
 * unconsented state before the default lands — which is exactly the leak the
 * banner exists to prevent. It is therefore a plain inline <script> placed
 * above <GoogleTagManager /> in the document head, not a next/script component:
 * inline script ordering in <head> is guaranteed, next/script strategies are
 * negotiated by the framework.
 *
 * Defaults:
 *   - Advertising (ad_storage, ad_user_data, ad_personalization) → DENIED
 *     everywhere until the visitor accepts. This is the change of substance:
 *     the Google Ads tag currently runs unconditionally.
 *   - analytics_storage → GRANTED by default, DENIED in the EEA/UK/CH. First-
 *     party aggregate analytics are disclosed in the privacy policy and are
 *     lawful without prior consent in the US, which is where essentially all
 *     traffic is; the stricter regions get the stricter default rather than a
 *     judgement call about which rule applies.
 *
 * A stored decision is replayed inline here too. Consent Mode state does not
 * survive a page load, so without this replay a returning visitor who accepted
 * would start every page denied until React hydrated and the banner ran — long
 * enough for tags to fire with the wrong state.
 *
 * Students (Privacy Policy §9.4): on registration pages, the member platform,
 * and in a browser where a student has signed in, the stored decision is NOT
 * replayed and advertising stays denied — see lib/no-ads.ts.
 */

// STRICT_REGIONS moved to lib/consent.ts: the HubSpot tracking script has to
// gate against the same list, and two copies would drift.

export function ConsentMode() {
  const script = `
(function(){
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  window.gtag = window.gtag || gtag;

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  gtag('consent', 'default', {
    region: ${JSON.stringify(STRICT_REGIONS)},
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500
  });

  var CONSENT_KEY = ${JSON.stringify(CONSENT_STORAGE_KEY)};
  // Replays a stored "Accept all" — except where advertising is off for
  // students, which wins whatever was stored. Storage blocked → denied default.
  ${noAdsScript(APP_HOST)}
})();
`.trim()

  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
