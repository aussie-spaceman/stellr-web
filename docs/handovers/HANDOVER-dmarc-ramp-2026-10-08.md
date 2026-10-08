# Handover — DMARC ramp for stellreducation.org (7–8 Oct 2026)

Slug: `dmarc-ramp`. Tracker: `tracker/2026-10-08-dmarc-ramp.md`.

**No code was changed and nothing was committed or promoted.** All the work was
in claude.ai cloud routines (RemoteTrigger) and the GoDaddy DNS record. This
handover is the only repo artefact.

## Context

On 26 Aug 2026, a duplicate `_dmarc` record was fixed and a three-step ramp was
scheduled as cloud routines: quarantine pct=25 (~16 Sept), full quarantine
(~30 Sept), then reject (~14 Oct). **The routines only advise.** They query DNS,
read the reports and tell David what to paste into GoDaddy. They never change
DNS.

Senders on the root domain: Google Workspace (mailboxes and the Apollo.io relay),
HubSpot (portal 24379847, `hs1/hs2-24379847._domainkey`), Resend
(transactional, SES-backed, selector `resend`, no custom MAIL FROM, so it relies on
DKIM alignment) and Clerk (`clk/clk2._domainkey`). SPF:
`v=spf1 include:amazonses.com include:_spf.google.com include:24379847.spf01.hubspotemail.net ~all`.

Reports go to `dmarc@stellreducation.org` **and** Postmark's free digest
(`re+etlsc18sh9o@dmarc.postmarkapp.com`), which was added after 26 Aug. The
weekly digest from `dmarc@postmarkapp.com` lands in Gmail and is how the reports
are actually read. **Every record value must keep both rua addresses.**

## What happened

| When | Fact | How verified |
|---|---|---|
| 16 Sept | Step 1 routine ran (`trig_0185Uj38AyXMMfXfCeuHd9WT`) and found one record, 99% aligned (Google 100% DKIM, SES/Resend 100% DKIM, Clerk 100%). It said to go to pct=25, "with one caveat (HubSpot)". | Run log `cse_013jSxua2FjiEzoraCyFB2e2`. The caveat text was truncated in the log and was never read. |
| 30 Sept | Step 2 routine ran (`trig_01Rw3zPXNDLoMeCDBd9PqGyn`). The record was still `p=none`, so it repeated the pct=25 value with both rua addresses. | Run log `cse_01W7i8uWR9W1VModTM2rzT7r` |
| 7 Oct | The live record was still `p=none` on ns05/ns06, 8.8.8.8, 1.1.1.1 and 9.9.9.9. The Postmark digest for 27 Sept–4 Oct showed 508 emails, 98% aligned. | `dig`, and a Gmail read by the test routine |
| 7 Oct | The step 3 prompt assumed full quarantine, and its reject value dropped the Postmark rua. It was rewritten to work from the live state. | RemoteTrigger get |
| 8 Oct | David set `p=quarantine; pct=25` with both rua addresses, TTL 1800. One record, identical on all five resolvers. | `dig` on 8 Oct |
| 8 Oct | Checkpoints scheduled for 22 Oct (full quarantine) and 5 Nov (reject). The 14 Oct routine was updated to a first-week health check that knows about them. | RemoteTrigger create/update responses |

## Routines now scheduled (all one-shot, push and email notifications)

| ID | Name | Fires (UTC) | Connectors |
|---|---|---|---|
| `trig_01CfwVen1J8BPBk98RbgGTNB` | DMARC checkpoint — pct=25 first-week health check | 2026-10-14 15:00 | the original 13, incl. Gmail |
| `trig_01LaZXji4RKfHmAmpscnv4aG` | DMARC checkpoint — full quarantine (22-Oct) | 2026-10-22 15:00 | Gmail only |
| `trig_01DEYTS6rcN4NkxHLUHVHrVT` | DMARC checkpoint — p=reject (05-Nov, final) | 2026-11-05 16:00 (09:00 MST) | Gmail only |
| `trig_01VkFW7PUXi4531nccpJHFoz` | TEMP — capability test | disabled | Gmail; safe to delete |

Each prompt carries the history, all three exact values, and the rule against
advancing if a legitimate sender fails. Each also handles a skipped or
reverted step.

## Gotcha: RemoteTrigger `update` replaces `session_context`

Sending `job_config.ccr` in an update **replaces** `session_context` wholesale.
The 14 Oct routine lost its Cowork system prompt, its `model: claude-opus-5` and
its effort setting. When `session_context` is left out, `session_request.config`
becomes `null`. Including `session_context` (the default preset tool list)
regenerates it.

The default preset was proven by a test routine with the same environment and the
Gmail connector, which read DNS and the Postmark digest in 12 s. These routines now
run on the default model, which was Sonnet 5.5 in the test.

## Not verified

- **None of the three live checkpoint prompts has run.** Only the capability test
  ran. The first real proof is the 14 Oct run.
- **HubSpot alignment is unproven.** HubSpot did not appear as a source in the
  Postmark digests we saw, and the step 1 HubSpot caveat was never read in full.
  Read it at <https://claude.ai/code/session_013jSxua2FjiEzoraCyFB2e2>.
- The 2% unaligned in the 27 Sept–4 Oct digest was not broken down by source. The
  week before, it was `cloud-sec-av.com` (a forwarding gateway).
- The 22 Oct and 5 Nov steps happen only if David edits GoDaddy himself.

## Open follow-ups (outside the ramp)

- Apollo.io cold outbound still uses the primary domain. Move it to a lookalike
  domain so complaints don't hurt Workspace and Resend reputation.
- MTA-STS and TLS-RPT are absent: no `_mta-sts` or `_smtp._tls` TXT records on
  7 Oct. They matter because Stellr handles minors' data.
- Optional later: a custom MAIL FROM subdomain for Resend/SES, which would make
  SPF align. It's needed only for strict alignment.
