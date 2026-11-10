# Handover: event email saved templates and post-event merge fields — 2026-11-09

Slug: `email-templates-fields`. Tracker: `tracker/2026-11-09-email-templates-fields.md`.
PR #596 → `dev` as `9cec6adf`. **Not promoted.** Migration: `20261109230000_event_email_templates.sql`, on the dev database only.

## Context

The owner asked for two improvements to an event's **Email Reminders** tab, for every regular event:

1. **Saved templates** available across events. The Colorado close-out email had been copied into the Nevada event by hand.
2. **New merge fields**: award winner names, the champion company, the event feedback link, and links to each student's certificate PDFs and credentials. The Colorado and Nevada close-out emails list award winners as bullet points typed by hand.

Owner's answers to the design questions:
- Winner names are first names only, with a last initial only when two winners share a first name. The email goes to every family on the roster.
- The certificate link is a signed PDF link that works without signing in.
- The feedback link is the event survey page (`/survey/event/<slug>`).
- Admins and event managers can save, rename and delete templates.

## What changed

### Saved templates
- New tenant-owned table `public.event_email_templates`. It has RLS, the tenant isolation policies and `tenant_app` grants, and it is classified `own` in `lib/tenancy/registry.ts`.
- A template keeps an email's groups, subject, body, DocuSign re-send flag, schedule and source event. It does **not** keep attachments: those are stored per event, the same rule as Duplicate.
- API:
  - `app/api/admin/events/[slug]/email-templates` handles list (GET) and save (POST).
  - `.../email-templates/[id]` handles rename or overwrite (PATCH) and DELETE.
  - The existing `.../emails` POST takes `{ savedTemplateId }` to create a draft from a saved template. It returns 404 for another tenant's template.
  - All writes are audited as `event_email.template.create`, `.update` and `.delete`.
- UI:
  - **Save as template** in the email editor, on drafts and sent emails alike. Reusing an existing name offers to overwrite that template.
  - A **Saved templates** group in the **+ Add email…** picker.
  - **Manage saved templates** to rename and delete them.

### Merge fields (`lib/event-emails/types.ts` `EVENT_MERGE_FIELDS`)

| Field | Source |
|---|---|
| `{{champion_company}}` | `event_award_assignments` (overall_champion) → `event_companies`; "Company N" when the company has no name |
| `{{individual_award_winners}}`, `{{norm_chaffee_winners}}`, `{{anita_gale_winners}}`, `{{dick_edwards_winners}}` | `event_award_assignments` joined to `participants` (`lib/event-emails/awards.ts`) |
| `{{feedback_link}}` | `${AUTH_APP_URL}/survey/event/<slug>` |
| `{{certificate_links}}` | Issued `source='event'` credentials, one line per credential, each with the family PDF link |
| `{{credential_links}}` | The same credentials, linking to the family credential page (the existing `?k=` link) |

- Award values are read only when the email uses one of the award tokens (`eventVarsFor` in `lib/event-emails/send.ts`).
- Who gets which credential lines (`attachCredentialLines` in `lib/event-emails/audiences.ts`):
  - A student gets their own credentials.
  - A guardian gets each of their children's, labelled with the child's first name.
  - A mentor gets theirs, matched by member email.
  - Participation certificates come first.
- Preview and test sends show `[certificate link]` / `[credential link]` placeholders, the same as signing links.
- Preview, and the **Send now** confirm, warn about fields that will come out empty.

### Family certificate link
- `GET /api/credentials/[number]/certificate?k=<token>` is a public route:
  - The HMAC token has its own purpose prefix, `stellr-credential|pdf|<id>` (`lib/credentials-link.ts`). The view link cannot download, and the download link cannot view.
  - It allows 20 requests a minute.
  - It returns 404 without a valid token and 410 if the credential is revoked.
  - It honours the survey gate on certificates.
  - It records no credential event.
- PDF drawing moved to `lib/credential-pdf.ts`, which the holder's own `/pdf` route now shares. The course-template lookup stays in the holder-only route, so the public route never reaches `lib/community`.
- It uses the same secret chain as the credential family link: `CREDENTIAL_LINK_SECRET` → `SURVEY_TOKEN_SECRET` → `ESIGN_TOKEN_SECRET`. Without any of those, the field renders empty and preview warns about it.

## Verified
- CI on the final head (`261c9847`): every check passed. The unit tests, both Playwright suites (`e2e-tests` and `e2e-local`), pgTAP `db` (tenant isolation now covers the new table), the build and lighthouse all ran their steps.
- Locally, on the merged tree: 573 files / 11,747 tests pass, and typecheck, `lint:migrations`, `lint:tokens` and `lint:pii` are clean.
- Against the dev database, with temporary seed data that has since been removed:
  - Preview showed the champion company, the winners, the feedback link, per-recipient certificate and credential lines, and the empty-field warnings.
  - Saving, creating from, renaming, overwriting and deleting a template all worked. An unknown template returned 404.
  - The certificate link returned the correct PDF on the event's award artwork. A view token, another credential's token and no token all returned 404.

## Not verified
- **Production**: nothing of this is there. The migration must be applied to production before the code reaches `main`.
- A real send using the new fields, with real minted links.
- The family certificate link opened signed out on production.
- The `dev` deployment of `9cec6adf`. Vercel showed `stellr-web-dev` still "deploying" when this was written.

## Open items
See `tracker/2026-11-09-email-templates-fields.md`, rows `email-templates-fields.1`–`.6`.
