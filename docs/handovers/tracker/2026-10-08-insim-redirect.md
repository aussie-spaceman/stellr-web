# insimeducation.com redirect — 2026-10-08

Slug: `insim-redirect`. Handover: `HANDOVER-insim-redirect-2026-10-08.md`. Doc snapshot: `14HSQCrj03PZTuI2TzT-Y9OpRGcGzfUWXbdclZqFAyNI`.
No PR to `dev` for code: this was an infrastructure-only fix (Vercel project domains + GoDaddy DNS). Migration: none.

Every insimeducation.com URL, with or without `www`, over http or https and on any path, now 308-redirects to the same path on `https://www.stellreducation.org`. This is done by Vercel redirect domains on the `stellr-web` project. Before, `www` had no DNS record and every path except `/` returned 404.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| insim-redirect.1 | Google Search Console change of address | 8 Oct: not checked whether insimeducation.com has a GSC property. | In GSC, open the insimeducation.com property if there is one, then Settings → Change of address → stellreducation.org. If there is no property, close the row. | ☐ |
| insim-redirect.2 | Leftover Resend DNS records on insim | 8 Oct: `resend._domainkey`, `send` MX/TXT and `dc-fd741b8612._spfm.send` are still in the GoDaddy zone. Resend dropped the domain on 12 Aug (`docs/PLAN-single-email-domain.md`). They are harmless and were left alone on purpose. | Optional: delete those four records in GoDaddy. Keep the Google MX, HubSpot DKIM and the `@` SPF records. | ☐ |
| insim-redirect.3 | Certificate auto-renewal | 8 Oct: `cert_jv75Om3CBwJBFLgJxJIMYa41` covers both hostnames, expires in 90 days (~6 Jan 2027), renew = yes. It was issued manually with `vercel certs issue`. | In the first week of January 2027, `npx vercel certs ls --scope stellreducation` should show a newer insim cert. | ☐ |
| insim-redirect.4 | www + deep paths redirect | 8 Oct: `curl -L` through public DNS, all 12 combinations (http/https × apex/www × `/`, `/competitions`, `/about?x=1`), ends at the matching stellreducation.org URL with a 200, query kept. Vercel `/v6/domains/*/config` reports `misconfigured: false` for both. | — | ☑ |
