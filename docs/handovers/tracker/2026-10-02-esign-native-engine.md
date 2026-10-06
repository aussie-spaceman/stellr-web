# Stellr signing (in-app e-signature engine) — 2026-10-02

Slug: `esign-native-engine`. Handover: `HANDOVER-esign-native-engine-2026-10-02.md`.
Squash-merged to `dev`; not promoted. Migrations: five (listed in the handover).

All three phases of `docs/PLAN-esign-2026-10-02.md` built and tested on dev.
Production stays DocuSign-only until David completes the handover's steps.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-native-engine.1 | Production migrations (6, incl. `20261002235609_esign_agreements_v2_3`) | All six applied to production; `20261002235609` on 3 Oct before #279 (29be23e), ledger re-read (one row) | None | ☑ |
| esign-native-engine.2 | Production env vars (token, backup, counter-sign, seal cert, Resend webhook secret) | Not set | David | ☐ |
| esign-native-engine.3 | CA-issued seal certificate | Dev uses a self-signed one; production refuses that | David buys a document-signing cert | ☐ |
| esign-native-engine.4 | Production templates (V2.3) | Dev: minor/adult/mentor v3 converted from the V2.3 Word files, field maps in `lib/esign/native/templates/*-v2-3.fields.json`, text versions from the .docx | Production: convert with `--map`, publish, check, approve under David's name; then `check --export` against the updated DocuSign templates | ☐ |
| esign-native-engine.5 | Membership agreement wording (adult only: a Minor joining now signs the V2.3 Student / Minor agreement) | Dev placeholder | David supplies wording | ☐ |
| esign-native-engine.6 | Policy, Terms, School Data Terms wording approval | Drafted and published on dev | David approves before 9 Oct | ☐ |
| esign-native-engine.7 | Drop compatibility views (rename step 2) | `docs/esign/migration-step-2-drop-compat-views.sql` | After the new code is live in production | ☐ |
| esign-native-engine.8 | `MEMBERSHIP_AGREEMENT_ENFORCE` | Off (report-only) | David decides what to hold and from when | ☐ |
| esign-native-engine.9 | Media, quote and digital-comms opt-outs shown to staff | Columns + read-back (both engines) + admin Consent forms "Opt-outs" column built | Roster pill/CSV for event staff and photographers | ☐ |
| esign-native-engine.10 | Brand `primary` fails AA for 14px text (site-wide default Button) | Signing pages use `primaryStrong` | David decides on a site-wide change | ☐ |
| esign-native-engine.11 | 14 policy/code conflicts (`docs/compliance/README.md`) | Listed | Owner decisions; counsel advised on COPPA/FERPA/CPA points | ☐ |
| esign-native-engine.12 | DocuSign account settings (attachments off, AI data sharing off) | Unconfirmed | David | ☐ |
| esign-native-engine.13 | Signing link in the pay-link email | Deliberately not built: the email is cc'd registrant + parent, so a personal link there breaks guardian identity | None unless the email stops being cc'd | ☐ |
| esign-native-engine.14 | DocuSign V2.3 templates carry the new tab labels | David updating 3 Oct (waiting on DocuSign support). Until then DocuSign rows record no version (`DOCUSIGN_AGREEMENT_VERSION` unset), so forms signed on the old template are not reused as V2.3 | Labels set 6 Oct through the API (`scripts/docusign-label-minor-tabs.ts`, `--doc minor` / `--doc mentor`): minor 9 fields, including the quote box that the editor had labelled `CredentialSharingOptOut`; mentor 4 fields, including emergency phone labelled `MentorPhone`, and the parent block's 3 Mentor-role fields deleted. Adult: MediaOptOut labelled. All three pass `check-docusign-template.mjs` (V2.3 contract). `DOCUSIGN_AGREEMENT_VERSION=2.3` set in Vercel by David 6 Oct | ☑ |
| esign-native-engine.15 | Returning students re-sign once | Pre-V2.3 minor agreements are not reused (no version recorded), so each returning student's family signs V2.3 at their next event | Accepted by David 2 Oct | ☑ |
| esign-native-engine.16 | Mentor under the age of majority (AL/NE 19, MS 21) | Always Stellr signing, parent from the emergency contact; fails with an admin alert if Stellr signing is off | Not an issue: Stellr signing goes to production 2 Oct (David) | ☑ |
| esign-native-engine.17 | State for the age of majority | The school's state (registrations); members have no state column, so membership uses 18 | Acknowledged by David 2 Oct; a home-state field only if it comes to matter | ☑ |
| esign-native-engine.18 | NY/CO photo and quote opt-in for 13–17 | Not built (follow-up in #274's runbook) | Separate ticket | ☐ |

