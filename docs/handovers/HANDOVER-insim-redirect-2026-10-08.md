# Handover — insimeducation.com → stellreducation.org redirect (8 Oct 2026)

Slug: `insim-redirect`. Tracker: `tracker/2026-10-08-insim-redirect.md`.

**No code was committed and nothing was promoted.** This was an infrastructure fix,
made in the Vercel project settings and GoDaddy DNS. The repo has no configuration
for the old domain, and none is needed: Vercel's domain-level redirect handles
it before the app runs.

## What was asked

Confirm that www.insimeducation.com forwards to www.stellreducation.org, and if it
did not, find the root cause and fix it.

## What was wrong (as found 8 Oct, before any change)

The domain used **GoDaddy Domain Forwarding**, with A @ → `3.33.251.168` / `15.197.225.128`
(GoDaddy's forwarder).

| URL | Result |
|---|---|
| `insimeducation.com/` | 301 → `https://www.stellreducation.org/` (worked) |
| `insimeducation.com/<anything>` | **404**: GoDaddy forwarding does not pass paths through |
| `www.insimeducation.com/…` | **did not resolve**: there was no `www` record on the authoritative `ns49/ns50.domaincontrol.com`. The zone's SOA serial was `2026062901`, so it was last edited 29 June |

## What changed

1. **Vercel (done by Claude, via `vercel api`).** `insimeducation.com` and `www.insimeducation.com`
   were added to the **`stellr-web`** (production) project as domains with
   `redirect: www.stellreducation.org`, `redirectStatusCode: 308`. Both show as verified.
   The redirect preserves path and query string.
2. **GoDaddy (done by David).**
   - Domain Forwarding was deleted.
   - A @ was set to `216.198.79.1` + `64.29.17.1`.
   - Deleting Forwarding made GoDaddy **auto-create `CNAME www → @`**. That is why a
     manual `www` CNAME was rejected with "Record name www conflicts with another record".
     It works as is: www → apex → Vercel IPs, and Vercel reports it `misconfigured: false`.
3. **Certificate.** It did not appear on its own within about 2 minutes, so
   `npx vercel certs issue insimeducation.com www.insimeducation.com --scope stellreducation`
   was run. The certificate is `cert_jv75Om3CBwJBFLgJxJIMYa41`: 90 days, auto-renew **yes**.

The other 19 zone records were not touched: Google MX, HubSpot DKIM CNAMEs, `pay`,
`_domainconnect`, the SPF TXT and the three `dc-…_spfm` TXT records, `MS=1167371`, the
`send` MX/TXT, `resend._domainkey` and `_dmarc` (`p=none`). David holds PDF backups of
both GoDaddy zones taken before the change. GoDaddy's printed DNS page cuts off the last
record or two: the insim printout lacked `_dmarc`, which was read from DNS instead.

## How it was verified

After the change, through public resolvers (1.1.1.1 and 8.8.8.8 both return the Vercel
IPs), without pinning, `curl -L` was run on all 12 combinations: http/https ×
apex/www × `/`, `/competitions`, `/about?x=1`. Each ended at the matching
`https://www.stellreducation.org/…` URL with a 200, query preserved.
- https takes 1 hop.
- http takes 2 hops: Vercel upgrades to https, then redirects.

The first http apex run returned GoDaddy's 404, from a stale local resolver.
`%{remote_ip}` then showed the Vercel IP and a 308.

## Not verified / gaps

- No check in a real browser by a person. curl only.
- Nobody has looked at whether insimeducation.com has a Google Search Console property,
  so no change-of-address has been filed (`insim-redirect.1`).
- The Resend records on insim (`resend._domainkey`, `send` MX/TXT, `dc-fd741b8612._spfm.send`)
  are leftovers. Resend dropped the domain on 12 Aug (`docs/PLAN-single-email-domain.md`
  step 4 calls removing them optional). They were left alone on purpose because they are
  harmless (`insim-redirect.2`).

## Rollback

Delete the two `@` A records and re-add Domain Forwarding in GoDaddy (→ `https://www.stellreducation.org`,
301). The Vercel domain entries are harmless if left in place.
