# DMARC ramp for stellreducation.org — 2026-10-08

Slug: `dmarc-ramp`. Handover: `HANDOVER-dmarc-ramp-2026-10-08.md`. Doc snapshot: `1A1rKa0jrekdcH6k78PR-wuRbYY3A9F48jBrm1ddZ3vM`.
No PR to `dev` for code; no promotion. Migration: none. Work was in cloud routines + GoDaddy DNS.

`_dmarc.stellreducation.org` moved from `p=none` to `p=quarantine; pct=25` on 08-Oct-2026 (both rua kept, verified on 5 resolvers). Checkpoint routines fire 14 Oct, 22 Oct and 5 Nov.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| dmarc-ramp.1 | Confirm steps 1 and 2 ran | Both fired and notified (run logs cse_013jSxua…, cse_01W7i8uW…). Neither DNS change was applied until 8 Oct. | — | ☑ |
| dmarc-ramp.2 | Quarantine pct=25 live | `p=quarantine; pct=25; rua=dmarc@…,re+etlsc18sh9o@dmarc.postmarkapp.com; aspf=r; adkim=r`, TTL 1800, one record, identical on ns05/ns06/8.8.8.8/1.1.1.1/9.9.9.9 (`dig`, 8 Oct) | — | ☑ |
| dmarc-ramp.3 | 14 Oct health check runs correctly | `trig_01CfwVen1J8BPBk98RbgGTNB` enabled, fires 2026-10-14T15:00Z. Prompt rewritten; session_context reset to default preset. Never run with this prompt. | Read the run after 15:00Z on 14 Oct: did it read DNS and the Postmark digest, and say "hold"? | ☐ |
| dmarc-ramp.4 | Full quarantine (no pct) | Checkpoint `trig_01LaZXji4RKfHmAmpscnv4aG` scheduled for 2026-10-22T15:00Z (Gmail only). Not yet due. | David pastes the full-quarantine value on ~22 Oct if the run says the reports are clean | ☐ |
| dmarc-ramp.5 | p=reject | Checkpoint `trig_01DEYTS6rcN4NkxHLUHVHrVT` scheduled for 2026-11-05T16:00Z. Not yet due. | David pastes the reject value on ~5 Nov, then raises TTL to 1 Hour | ☐ |
| dmarc-ramp.6 | HubSpot alignment proven | Not seen as a source in the Postmark digests. Step 1's HubSpot caveat was truncated and never read. | Read the step 1 run (claude.ai/code/session_013jSxua2FjiEzoraCyFB2e2); confirm a HubSpot send shows DKIM-aligned in a digest | ☐ |
| dmarc-ramp.7 | Delete the test routine | `trig_01VkFW7PUXi4531nccpJHFoz` is disabled. The API has no delete. | Delete it in the claude.ai routines UI | ☐ |
| dmarc-ramp.8 | Apollo outbound off the primary domain | Still on stellreducation.org via the Workspace relay | Decide on a lookalike domain for cold outbound | ☐ |
| dmarc-ramp.9 | MTA-STS + TLS-RPT | No `_mta-sts` or `_smtp._tls` TXT (`dig`, 7 Oct) | Publish the TLS-RPT TXT, then the MTA-STS policy (needs a hosted `mta-sts.` file) | ☐ |
