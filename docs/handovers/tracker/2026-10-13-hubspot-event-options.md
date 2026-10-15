# HubSpot event options follow Sanity — 2026-10-13

Slug: `hubspot-event-options`. Handover: `HANDOVER-hubspot-event-options-2026-10-12.md`. Doc snapshot: `1UwCwvB3CR2JOMPUVjUPd5K_5my1nLefyraTvQSoBO4s`.
PR #402 → `dev` as `149b6d3b`; promoted in #404 (`4f45bac5`), record #406. Migration: none.

HubSpot's Event Location / Year / Theme / Demographic option lists, on contacts and deals, now follow the live Sanity events.
- **Retired options are hidden, never deleted.** The options were applied to the portal on 12 Oct and verified, and the triggers are live in production: the event-sync webhook step and the daily cron `hubspot-event-options` at 04:45 UTC.
- **"Get Notified" now merges** the event multi-selects into a contact's history instead of replacing it.
- **Rows below** are items not yet exercised on production, plus small follow-ups.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| hubspot-event-options.1 | First prod cron run | Cron route deployed and guarded: prod answers 401, not 404, on 13 Oct. Never run yet. | After 04:45 UTC 14 Oct, read `cron_runs` for job `hubspot-event-options`: expect ok=true, `updated: []`, `unmapped: []` | ☐ |
| hubspot-event-options.2 | Webhook path + Sanity webhook config | event-sync deployed with the sync step (403 without the secret on 13 Oct). Our token can't read Sanity webhook settings, so whether the webhook fires is unknown. | Publish any event edit in Studio, then check the event-sync response or Vercel log for `hubspotOptions` (or Sanity → API → Webhooks) | ☐ |
| hubspot-event-options.3 | Event Notify form after API PATCH | Form options refreshed by API on 12 Oct; a later read matched (dry run reported "unchanged"). No real submission since the PATCH. | Watch the next real "Get Notified": `captureLead` should report `via: 'form'`; a `form-submit-failed` warning means the PATCH broke the form | ☐ |
| hubspot-event-options.4 | `captureLead` multi-select merge on prod | Unit-tested. Hidden + visible merged write accepted by HubSpot on a throwaway contact, since archived. No real prod capture yet. | On the next real Get Notified from an existing contact, confirm their prior `event` / `event_year` values survived | ☐ |
| hubspot-event-options.5 | Deal-schema scope puzzle | Service Key token-info lists only `crm.schemas.contacts.write`, yet the deal property PATCHes on 12 Oct succeeded | Nothing needed unless a deal sync 403s; then add `crm.schemas.deals.write` to the key | ☐ |
| hubspot-event-options.6 | Hidden deal options with misleading labels | `Iowa` (label "North Carolina [Raleigh]") and `Canada (Virtual)` (label "Virtual…") hidden, 0 deals each | Optional: delete both in HubSpot → Properties → Event Location (deals) | ☐ |
| hubspot-event-options.7 | Legacy special labels | The old special-case title regex is gone; such an event now gets "State [City]" unless overridden | When such an event is added in Sanity, set `hubspotLocation` to the legacy label before publishing | ☐ |
| hubspot-event-options.8 | Supabase-side school-year drift (out of scope) | `lib/event-participation-sync.ts:60` and `lib/survey/access.ts:218` use the calendar year; `lib/grade-logic.ts:126` rolls over in July. HubSpot unaffected. | Align on `schoolYearFor()` (`lib/hubspot-fields.ts`) when those files next change | ☐ |
| hubspot-event-options.9 | Sanity overrides set | Nebraska → "Nebraska [SAC Museum]", Uruguay → "Uruguay", Colorado SDC → "Colorado [Denver]". Set by API on 12 Oct (tx `5Bbl4CcKsVSHFUDp54Q3Tk`), read back; sync shows them as the live labels. | — | ☑ |
| hubspot-event-options.10 | Option lists applied (contacts + deals + form) | Script `--apply` on 12 Oct; read back through the API; second dry run all `unchanged`; contact counts per location unchanged | — | ☑ |
