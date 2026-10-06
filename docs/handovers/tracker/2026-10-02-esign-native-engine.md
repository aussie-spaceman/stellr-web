# Stellr signing (in-app e-signature engine) — 2026-10-02

Slug: `esign-native-engine`. Handover: `HANDOVER-esign-native-engine-2026-10-02.md`. Doc snapshot: `1N1iATszsucPQSDE2ABr-tcgl8LDJpzOH5HPOfYjPHzI`.
#273 → `dev` as `f13a7c9`, promoted in #276 (`f9722fa`). V2.3 alignment #280 → `dev` as `00d5a13`, promoted in #279 (`29be23e`). DocuSign V2.3 labels #295 → `dev` as `b563bc7`. Migrations: six, all in production.

All three phases of `docs/PLAN-esign-2026-10-02.md` are in production, **inert**: `esign_provider_state.mode = docusign_only` and no `ESIGN_*` variable in either Vercel project (checked 6 Oct). DocuSign takes every agreement except the ones only Stellr signing can issue (membership, a mentor under the age of majority), which land in "Needs paperwork".

| # | Item | State | Next | Done |
|---|---|---|---|---|
| esign-native-engine.1 | Production migrations (6, incl. `20261002235609_esign_agreements_v2_3`) | All six applied to production; `20261002235609` on 3 Oct before #279 (`29be23e`), ledger re-read (one row), 26 signed originals all `retain_until` NULL (active accounts) | None | ☑ |
| esign-native-engine.2 | Production env vars (token, backup, counter-sign, seal cert, Resend webhook secret) | None of `ESIGN_*` set in stellr-web or stellr-web-dev (`vercel env ls`, 6 Oct). Until they are, membership agreements and under-majority mentors go to "Needs paperwork" | David sets them (handover, "Production, in order") | ☐ |
| esign-native-engine.3 | CA-issued seal certificate | Dev uses a self-signed one; production refuses that | David buys a document-signing cert | ☐ |
| esign-native-engine.4 | Production Stellr-signing templates (V2.3) | Dev only: minor/adult/mentor v3 active, from the V2.3 Word files (`lib/esign/native/templates/*-v2-3.fields.json`); none published in production | Before switching Stellr signing on: convert with `--map`, publish, check, approve under David's name in production | ☐ |
| esign-native-engine.5 | Membership agreement wording (adult only: a Minor joining signs the V2.3 Student / Minor agreement) | Dev placeholder | David supplies wording | ☐ |
| esign-native-engine.6 | Policy, Terms, School Data Terms wording approval | Superseded: the Privacy Policy and Terms of 02-Oct-2026 and School Data Terms v2 went live with David's approval in #276 and #279 (legal-self-registration session) | None | ☑ |
| esign-native-engine.7 | Drop compatibility views (rename step 2) | `docs/esign/migration-step-2-drop-compat-views.sql` not run; the new names have been live in production since 3 Oct | Run once a rollback past #276 is no longer wanted | ☐ |
| esign-native-engine.8 | `MEMBERSHIP_AGREEMENT_ENFORCE` | Off (report-only) | David decides what to hold and from when | ☐ |
| esign-native-engine.9 | Media, quote and digital-comms opt-outs shown to staff | Columns + read-back (both engines) + admin Consent forms "Opt-outs" column in production | Roster pill/CSV for event staff and photographers | ☐ |
| esign-native-engine.10 | Brand `primary` fails AA for 14px text (site-wide default Button) | Signing pages use `primaryStrong` | David decides on a site-wide change | ☐ |
| esign-native-engine.11 | 14 policy/code conflicts (`docs/compliance/README.md`) | Listed; retention conflict resolved by #280 | Owner decisions; counsel advised on COPPA/FERPA/CPA points | ☐ |
| esign-native-engine.12 | DocuSign account settings (attachments off, AI data sharing off) | Unconfirmed | David | ☐ |
| esign-native-engine.13 | Signing link in the pay-link email | Deliberately not built: the email is cc'd registrant + parent, so a personal link there breaks guardian identity | None unless the email stops being cc'd | ☑ |
| esign-native-engine.14 | DocuSign V2.3 templates carry the app's field labels | Set 6 Oct through the API (`scripts/docusign-label-minor-tabs.ts --doc minor|mentor|adult`): minor 9 fields (the quote box had been labelled `CredentialSharingOptOut`), mentor 4 (emergency phone had been `MentorPhone`; parent block's 3 Mentor-role fields deleted), adult 1. All three pass `check-docusign-template.mjs`. `DOCUSIGN_AGREEMENT_VERSION` exists in both projects (Secret, created 6 Oct; value not readable back) and the 17:10Z production deployment postdates it | None | ☑ |
| esign-native-engine.15 | Returning students re-sign once | Pre-V2.3 minor agreements are not reused, so each returning family signs V2.3 at their next event | Accepted by David 2 Oct | ☑ |
| esign-native-engine.16 | Mentor under the age of majority (AL/NE 19, MS 21) | Always Stellr signing, parent from the emergency contact; until .2 they land in "Needs paperwork" | Accepted by David 3 Oct | ☑ |
| esign-native-engine.17 | State for the age of majority | The school's state; members have no state column, so membership uses 18 | Acknowledged by David 2 Oct | ☑ |
| esign-native-engine.18 | NY/CO photo and quote opt-in for 13–17 | Not built (follow-up in #274's runbook) | Separate ticket | ☐ |
| esign-native-engine.19 | **HIGH.** First real DocuSign V2.3 agreements | Never exercised: no V2.3 envelope sent from the app since the labels were set. Pre-fill of `MinorEmail`/`MinorGrade`/emergency contact and read-back of `QuoteOptOut`/`MediaOptOut`/`DigitalCommsOptOut` (DocuSign form_data on a checkbox was never proven, see credentials-docusign close-out) are unproven | After the first completed minor, mentor and adult V2.3 envelope: open the PDF (fields filled), and read the row (`agreement_version = '2.3'`, opt-out columns, `form_data_read_at` set) | ☐ |
| esign-native-engine.20 | Dev data the survey gate depends on | Dev `esign_templates` minor v3 carries `document_version = 'V2.3'` (set by the post-event-survey session); survey invitations for minors look it up | Any newer minors template must set `document_version` too | ☐ |
