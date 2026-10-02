# Stellr signing (in-app e-signature engine) — 2026-10-02

Slug: `esign-native-engine`. Handover: `HANDOVER-esign-native-engine-2026-10-02.md`.
Squash-merged to `dev`; not promoted. Migrations: five (listed in the handover).

All three phases of `docs/PLAN-esign-2026-10-02.md` built and tested on dev.
Production stays DocuSign-only until David completes the handover's steps.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-native-engine.1 | Production migrations (5) | Applied on dev only | David runs them before promotion; re-read `db:status --prod` | ☐ |
| esign-native-engine.2 | Production env vars (token, backup, counter-sign, seal cert, Resend webhook secret) | Not set | David | ☐ |
| esign-native-engine.3 | CA-issued seal certificate | Dev uses a self-signed one; production refuses that | David buys a document-signing cert | ☐ |
| esign-native-engine.4 | Production templates from real exports + original PDFs | Dev uses sandbox exports (v2, cleaned) | Export, convert with `--pdf`, check, approve | ☐ |
| esign-native-engine.5 | Membership agreement wording (adult, minor) | Dev placeholders | David supplies wording | ☐ |
| esign-native-engine.6 | Policy, Terms, School Data Terms wording approval | Drafted and published on dev | David approves before 9 Oct | ☐ |
| esign-native-engine.7 | Drop compatibility views (rename step 2) | `docs/esign/migration-step-2-drop-compat-views.sql` | After the new code is live in production | ☐ |
| esign-native-engine.8 | `MEMBERSHIP_AGREEMENT_ENFORCE` | Off (report-only) | David decides what to hold and from when | ☐ |
| esign-native-engine.9 | Media and digital-comms opt-outs not shown to staff | Captured in signer values and on the PDF only | Decide: column + roster pill/CSV | ☐ |
| esign-native-engine.10 | Brand `primary` fails AA for 14px text (site-wide default Button) | Signing pages use `primaryStrong` | David decides on a site-wide change | ☐ |
| esign-native-engine.11 | 14 policy/code conflicts (`docs/compliance/README.md`) | Listed | Owner decisions; counsel advised on COPPA/FERPA/CPA points | ☐ |
| esign-native-engine.12 | DocuSign account settings (attachments off, AI data sharing off) | Unconfirmed | David | ☐ |
| esign-native-engine.13 | Signing link in the pay-link email | Deliberately not built: the email is cc'd registrant + parent, so a personal link there breaks guardian identity | None unless the email stops being cc'd | ☐ |
