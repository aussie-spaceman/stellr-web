# DMARC ramp for stellreducation.org — 2026-10-08

Slug: `dmarc-ramp`. Handover: `HANDOVER-dmarc-ramp-2026-10-08.md`. Doc snapshot: `1A1rKa0jrekdcH6k78PR-wuRbYY3A9F48jBrm1ddZ3vM`.
No PR to `dev` for code; no promotion. Migration: none. Work was in cloud routines + GoDaddy DNS.

`_dmarc.stellreducation.org` moved from `p=none` to `p=quarantine; pct=25` on 08-Oct-2026 (both rua kept, verified on 5 resolvers). Checkpoint routines fire 14 Oct, 22 Oct and 5 Nov.

**Update 13-Nov-2026:** full quarantine went live ~22 Oct, and `p=reject` went live 13 Nov. TLS-RPT and MTA-STS (testing) were published the same day. Open: MTA-STS enforce (reminder 2 Dec) and the `_dmarc` TTL raise (reminder 13 Dec). Both reminders are local scheduled tasks in the desktop app on the owner's Mac.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| dmarc-ramp.1 | Confirm steps 1 and 2 ran | Both fired and notified (run logs cse_013jSxua…, cse_01W7i8uW…). Neither DNS change was applied until 8 Oct. | — | ☑ |
| dmarc-ramp.2 | Quarantine pct=25 live | `p=quarantine; pct=25; rua=dmarc@…,re+etlsc18sh9o@dmarc.postmarkapp.com; aspf=r; adkim=r`, TTL 1800, one record, identical on ns05/ns06/8.8.8.8/1.1.1.1/9.9.9.9 (`dig`, 8 Oct) | — | ☑ |
| dmarc-ramp.3 | 14 Oct health check runs correctly | Ran on the previous Claude account. Superseded: full quarantine went live ~22 Oct and reject on 13 Nov, both on clean Postmark digests | — | ☑ |
| dmarc-ramp.4 | Full quarantine (no pct) | Live ~22 Oct (the 19 Oct Postmark digest shows pct=25, the 26 Oct digest shows 100%) | — | ☑ |
| dmarc-ramp.5 | p=reject | Live 13-Nov-2026: `p=reject; aspf=r; adkim=r` with both rua addresses (dmarc@ and the Postmark digest) kept, one record, identical on ns05/ns06/8.8.8.8/1.1.1.1/9.9.9.9 (`dig`). Postmark digests 11 Oct–9 Nov: 100% aligned. TTL still 1800 | Raise TTL to 1 Hour after a clean month; one-time reminder scheduled for 13-Dec-2026 | ☑ |
| dmarc-ramp.6 | HubSpot alignment proven | 13-Nov-2026: a real HubSpot marketing send (bf01.hubspotstarter.net) to a Gmail inbox showed DKIM pass, d=stellreducation.org, and DMARC pass. A HubSpot "Send test" proves nothing: it comes from hubspot.com. SPF passes only on HubSpot's own domain, so DKIM is its single aligned mechanism | — | ☑ |
| dmarc-ramp.7 | Delete the test routine | It lives on the previous Claude account, now downgraded to Free. Not worth doing | — | ☒ won't do |
| dmarc-ramp.8 | Apollo outbound off the primary domain | Owner decision 13-Nov-2026: don't pursue | — | ☒ won't do |
| dmarc-ramp.9 | MTA-STS + TLS-RPT | 13-Nov-2026: TLS-RPT TXT `_smtp._tls` = `v=TLSRPTv1; rua=mailto:dmarc@stellreducation.org`. MTA-STS in `mode: testing` (mx aspmx.l.google.com, *.aspmx.l.google.com; max_age 86400), served by the static Vercel project `stellr-mta-sts`, kept out of stellr-web because that app resolves tenants by host. CNAME `mta-sts` → Vercel, TXT `_mta-sts` = `v=STSv1; id=20261113`. HTTPS 200, text/plain, no redirects, Let's Encrypt cert. All records checked on 5 resolvers | Switch to `mode: enforce`, `max_age: 604800`, redeploy, bump the TXT id. One-time reminder scheduled for 2-Dec-2026 that reads the TLS reports first | ☐ |
