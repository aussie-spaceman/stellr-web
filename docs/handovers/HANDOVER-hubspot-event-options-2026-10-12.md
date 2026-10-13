# Handover — HubSpot event options follow Sanity (12 Oct 2026)

**For:** anyone touching the HubSpot Event Location / Year / Theme / Demographic
properties, `lib/hubspot-fields.ts`, `lib/hubspot-event-options.ts`, or adding
an event in Sanity.

**Prompted by:** the Deal "Event Location" dropdown had drifted from the event
list. It offered North Carolina and Virtual, and lacked Texas, Nebraska,
Uruguay and the campaigns. Behind its labels the stored values were wrong:
`Iowa` was labelled "North Carolina [Raleigh]".

## 1. The rule now

Sanity is the source of truth. The website derives each event's HubSpot values
from its Sanity document. `lib/hubspot-event-options.ts` keeps the option lists
of `event`, `event_year`, `event_theme` and `event_demographic` on **contacts
and deals** matching the live events.

| Property | Derived from | Visible | Hidden (data kept) |
|---|---|---|---|
| Event Location | `hubspotLocation` override, else `Campaign [Fall/Spring]` / `Virtual [Zoom + Discord]` / `Country [City]` / `State [City]` | Labels of live events | Everything else |
| Event Year | School year, August cutover (`campaignYear` for campaigns) | Every year up to the last live event's | Later years |
| Event Theme | Sanity `type` | Themes of live events | Others |
| Event Demographic | Grade band (≤8 gives Middle School, ≥9 gives High School) | Live values, plus College and High School (pinned) | Others |

- **"Live"** means not cancelled, and in the current school year or later. On
  1 Aug last year's options hide themselves.
- **Options are never deleted.** Sanity holds only the current season, so
  HubSpot is the only record of past ones (Texas [Houston] has 335 contacts).
  Hidden options keep their records, and HubSpot accepts API writes of hidden
  values (tested 12 Oct on a throwaway contact, since archived).
- **The one exception is a stale value:** an option whose label is a value the
  sync needs but whose stored value differs. It is dropped only after a live
  count shows 0 records. If records exist, it is relabelled "(legacy: …)" and
  hidden instead.
- **An empty Sanity read refuses to write**, rather than hiding every option.
- **Options added by hand in HubSpot are hidden on the next sync.** Every
  managed property's description now says so.

## 2. When it runs

- **Sanity publish:** the `app/api/admin/sanity/event-sync` webhook. It writes
  only on the real production app (`isRealProductionApp`), and its response
  carries a `hubspotOptions` summary.
- **Daily cron** at 04:45 UTC: `app/api/cron/hubspot-event-options`, with a
  `cron_runs` row for job `hubspot-event-options`. An unmapped event
  (e.g. one with no city) is recorded there as a failure.
- **By hand:** `npm run hubspot:sync-event-options` is a dry run that prints
  the diff; add `-- --apply` to write. There is one portal and no sandbox, so
  `--apply` from a laptop writes the live CRM.
  - `.env.local` has no `HUBSPOT_FORM_EVENT_NOTIFY`, so locally the form step
    is skipped unless you set it on the command.

The "Website — Event Notify" form keeps a frozen copy of each option list.
The sync refreshes every enumeration field on it. On 12 Oct that also added
`Unsubscribed` and the newer lead sources, which had been missing.

## 3. Lead capture now merges

The event properties are multi-checkboxes that hold history, and HubSpot
replaces a multi-select's whole value on write. "Get Notified" used to
overwrite a contact's history with the one event; at most 2 contacts were
affected.

`captureLead` now reads the four properties and writes the union. If the read
fails, the four fields are left out of the write and the capture logs the
warning `multi-select-skipped-unreadable`.

## 4. State on 12 Oct (applied and verified live)

**Sanity overrides set** (transaction `5Bbl4CcKsVSHFUDp54Q3Tk`; no drafts
existed):

| Event | `hubspotLocation` |
|---|---|
| Nebraska SDC | Nebraska [SAC Museum] |
| Uruguay EDC | Uruguay |
| Colorado SDC (Highlands Ranch) | Colorado [Denver] |

Texas uses the derived label **Texas [Austin]**.

**Applied** with the script (`--apply`), then read back through the API. A
second dry run reported every property and the form `unchanged`.

| Property | Contacts | Deals |
|---|---|---|
| `event` | Visible: Colorado [Denver], Nevada [Las Vegas], Minnesota [Mankato], Texas [Austin], Nebraska [SAC Museum], South Dakota [Brookings], Uruguay, Campaign [Fall]. Hidden: Virtual, North Carolina, Texas [Houston], ISSDC Finals, Pennsylvania, Arizona, Washington State | Same visible set. 3 stale values dropped (0 records each). `Iowa` and `Canada (Virtual)` hidden |
| `event_year` | 2023–2028 visible; 2029 and 2030 hidden | 2028 added |
| `event_theme` | Life Sciences and Resources hidden | Life Sciences and Resources hidden |
| `event_demographic` | Unchanged | Unchanged |

Contact counts per location are unchanged after the apply.

## 5. Open

1. **The webhook path is unproven in production.** It ships with the next
   promote. Afterwards, publish a trivial edit in Studio and check the
   event-sync response or logs for `hubspotOptions`. That is also the only
   check that the Sanity webhook is configured, because our token cannot read
   webhook settings.
2. **The cron is unproven.** After the promote, check the `cron_runs` row for
   `hubspot-event-options` (expect ok, with nothing updated).
3. **The deal-property scope is a puzzle.** The Service Key's token-info lists
   only `crm.schemas.contacts.write`, yet the deal-property PATCHes succeeded
   on 12 Oct. Adding `crm.schemas.deals.write` was not needed.
4. **Hidden deal options with misleading labels:** `Iowa` is labelled "North
   Carolina [Raleigh]" and `Canada (Virtual)` is labelled "Virtual". Both are
   hidden and hold 0 records. They could be deleted by hand, but that is not
   needed.
5. **Out of scope:** `lib/event-participation-sync.ts:60` and
   `lib/survey/access.ts:218` use the calendar year, and
   `lib/grade-logic.ts:126` rolls over in July. These are Supabase-side and
   don't affect HubSpot.
