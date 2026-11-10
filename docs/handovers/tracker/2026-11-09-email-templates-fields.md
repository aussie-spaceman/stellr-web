# Event emails: saved templates and post-event merge fields — 2026-11-09

Slug: `email-templates-fields`. Handover: `HANDOVER-email-templates-fields-2026-11-09.md`. Doc snapshot: `1ikcNwtR5xvMoHK9qUhZ4BHiKYVSUMKuBx-NUUvDEnIs`.
PR #596 → `dev` as `9cec6adf`; not promoted. Migration: `20261109230000_event_email_templates.sql` (dev database only).

Event emails can now be saved as tenant-wide templates and created from them on any event. Seven new merge fields fill in the champion company, award winners (first names), the event survey link, and each recipient's certificate PDF and credential links. The certificate links use a new signed public route, `/api/credentials/[number]/certificate?k=`.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| email-templates-fields.1 | Apply the migration to production | `event_email_templates` exists on dev (applied through MCP, ledger realigned to `20261109230000`). Not on production. | In promote: apply `20261109230000_event_email_templates.sql` to production with the owner's yes, **before** #596 merges to `main`, then re-read `db:status --prod`. | ☐ |
| email-templates-fields.2 | Promote #596 | On `dev` (`9cec6adf`); every CI step read and passing on head `261c9847`. Dev deployment still "deploying" at the time of writing. | Promote, after .1. | ☐ |
| email-templates-fields.3 | First real send with the new fields | Tested only through preview and placeholders against dev seed data. A real send mints links for each recipient (`mintPayLinks`); not run. | After .2: send a close-out email using `{{certificate_links}}` and the award fields to a staff test registration, and check the names and links in the received mail. | ☐ |
| email-templates-fields.4 | Family certificate link on production | Proven locally against dev (correct PDF; wrong-purpose, wrong-credential and missing tokens all 404). Production has the family-link secret chain (the credential family link is live there), but this route has not been opened there. | After .3: open one `certificate?k=` link from the received mail in a signed-out browser; expect the PDF. | ☐ |
| email-templates-fields.5 | Use the fields in the Nevada close-out draft | The Nevada draft still lists winners as hand-typed bullets. The fields exist only once .2 is done. | Owner, after .2: replace the typed names with `{{norm_chaffee_winners}}` etc. and check Preview. | ☐ |
| email-templates-fields.6 | Save the Colorado close-out as a template | The reason for the feature; not done, because it needs the production table (.1). | Owner, after .2: open the Colorado close-out email → **Save as template**. | ☐ |
