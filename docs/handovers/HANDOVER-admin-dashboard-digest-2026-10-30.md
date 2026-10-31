# Handover — admin member filters, activity dashboard, Friday digest (30 Oct 2026)

Tracker: `docs/handovers/tracker/2026-10-30-admin-dashboard-digest.md` (rows `admin-dashboard-digest.1–.7`). Nobody outside staff is involved, so the Doc snapshot holds no names this file doesn't.

## Why

David asked for three admin changes, with at least five clarifying questions first:

1. Filters on the members list (`/admin/members`) for the columns he circled: Name, Email, Role, Membership, School, Joined.
2. A dashboard digesting new activity in the member database: new registrations, anyone who left, interaction with spaces, mentoring and coaching sign-ups, and the outstanding items (DocuSigns, verifications, payments and so on).
3. The dashboard emailed to him every Friday at midday as a weekly summary.

## Owner decisions (30 Oct, David)

Eight questions over two rounds; each answer was the recommended option or "all of these":

- **Filters:** a filter row under the table headers plus sortable columns.
- **Left:** all of accounts closed, memberships lapsed, unsubscribed, withdrew from an event.
- **Mentoring:** coaching requests, joined a mentoring group, volunteered for an event, new mentors.
- **Outstanding:** unsigned consent forms, verifications, unpaid payments, the other admin queues.
- **Time zone:** Mountain (America/Denver).
- **Recipients:** active members holding the `all` staff scope.
- **Email privacy:** counts for every metric plus the top outstanding items; never a minor's name.
- **Dashboard period:** a 7 / 30 / 90-day toggle.

## What shipped

**#481 → `dev` `33f9d8f0`; promoted in #482 (`d9f4d657`, `dpl_BtsCz4ZrfEGasoAWg4uHwoWWPvGu`); record #483 (`6ec9e367`).** No migration, no new env vars. Another session's promotion #485 (`185e3356`, `dpl_BwZabiv7uEgRqQ7n1aWNhTFc5aHU`, 19:44 UTC) is now production and carries all of it.

- **Members list** (`app/(admin)/admin/members/page.tsx`, `components/admin/MemberTable.tsx`). A filter row under the headers: Name, Email and current School are text (Enter or leaving the field applies them); Role and Membership are selects, Membership including "No active membership"; Joined has from/to dates, read as Mountain-time days. Name, Email, Role and Joined sort. Every filter lives in the URL, and "Export filtered CSV" (`app/api/admin/members/export/route.ts`) exports exactly the filtered, sorted list. The `tier` param was accepted before but never applied; it now filters.
- **`lib/admin-member-filters.ts`** is the one home for parsing, applying and sorting those filters, shared by the page and the export. Membership and school filters use aliased second embeds (`tier_f`, `school_f`) so the displayed embeds stay complete; "No active membership" is an anti-join (`.is('tier_f', null)`).
- **Dashboard** (`app/(admin)/admin/page.tsx`, replacing the placeholder; parts in `components/admin/dashboard/`). Six tiles (New members, Registrations, Left or lapsed, Active in spaces, Mentoring & coaching, Waiting on you), activity panels, and "Waiting on you" panels for consent forms, verifications, payments and other requests. Each figure is compared with the window before. "New members" links to the members list filtered to the window and sorted by Joined. A Dashboard link heads the admin rail.
- **`lib/admin-digest.ts`** (`loadMemberDigest`) feeds both the dashboard and the email, so the two cannot disagree. Each section loads on its own: a failed query names its section in `errors` rather than showing zero. It reuses `registrationPaid()`, `getComplianceAudit()` and `loadPaperworkGaps()`, so payments, clearance and paperwork match the roster and compliance pages.
- **Weekly digest** (`app/api/cron/weekly-digest/route.ts`, `lib/admin-digest-email.ts`, `lib/weekly-digest-schedule.ts`). `vercel.json` runs it at 18:00 and 19:00 UTC on Fridays; only the run that lands in Denver's 12 o'clock hour sends, which keeps it at noon across daylight saving. A run recorded as sent in the last 20 hours blocks a duplicate. Recipients are active members whose `staff_roles` include `all`, falling back to `staffAlertEmail()` when there are none. The `cron_runs` row records counts only.
- **Preview:** "Email me this week's digest" on `/admin` (`app/api/admin/digest/send/route.ts`) sends the 7-day digest, subject prefixed `[Preview]`, to the signed-in admin's Clerk primary address only.

## How the metrics are defined

Worth knowing before anyone asks why a number differs from another page:

- **New members:** `members.created_at` in the window, by `event_role`. **Registrations:** `registrations.created_at` in the window.
- **Left or lapsed:** `members.deleted_at`, `members.marketing_unsubscribed_at` and `registrations.withdrawn_at` in the window, plus `member_memberships` rows `expired`/`cancelled` with `updated_at` in the window whose member holds no other active membership.
- **Active in spaces:** distinct members who posted, commented, reacted, sent space chat (channels with a `space_id`; DMs and cohort chat excluded) or joined a space in the window.
- **Mentoring & coaching:** `coaching_requests`, `cohort_members`, `volunteer_event_interest` and new `event_role = 'mentor'` members, created or added in the window.
- **Waiting on you** (not windowed):
  - **Consent forms:** agreements `created`/`sent`/`delivered` for upcoming events, excluding failed issues, plus the needs-paperwork gaps.
  - **Verifications:** licences to verify and flagged checks from the compliance audit.
  - **Payments:** unpaid card checkouts and individually-paid seats for upcoming events only, and unpaid invoices whatever the event date, oldest first.
  - **Other requests:** pending coaching requests, submitted scholarships, privacy requests `verified`/`in_progress`, and pending deletion requests.
- **Privacy in the email:** names appear only on outstanding items and never a minor's. A child's consent form is listed under the guardian, or as "A student's consent form"; a minor in a gap or payment is "A student". The coaching and scholarship queues are counts only.

## First production run (30 Oct)

- **Sent:** production `cron_runs` row `d1b03008-c485-4f35-81d8-3aea23b3ed02`, 18:26:28 UTC (12:26 MDT): `{"sent":true,"recipients":1,"delivered":1,"fallback":false,"newMembers":29,"outstanding":32}`. One recipient from the `all` staff scope, no fallback.
- **Skip held:** the 19:00 schedule fired at 19:50:59 UTC (13:50 MDT, on `dpl_BwZabiv7…`) and wrote no row. `weekly-digest` still has exactly one row for the day.
- Hobby fires a cron at some point within its scheduled hour, so the send time will vary between 12:00 and 12:59 Mountain.
- From 6 Nov (MST) the 19:00 UTC schedule becomes the sender; that switch is covered by unit tests only (`.7`).

## How it was verified

- `tsc`, eslint and `lint:tokens` clean. Full vitest: 2,567 passed, 51 of them new (filters, payment rules, email privacy, the DST schedule, the cron route).
- CI on #481 and on #482: every verify and e2e step read one by one (e2e 169 passed, 45 skipped, 0 failed).
- Local dev against the dev database, signed in as the e2e admin fixture, desktop and 375 px: `/admin`, `/admin?days=90`, `/admin/members`, and a role-filtered, Joined-sorted list (17 rows, all that role). All 200, no page errors, no horizontal scroll.
- The digest email rendered from dev data to a local file and checked for subject, counts, outstanding lists and no minors' names.
- Production after #482: www 200; app 307 to `/sign-in`; the cron guard 401; `/api/cron/weekly-digest` 401 without the secret on www and app; `POST /api/admin/digest/send` signed out 403; the export signed out 403; `/admin` and `/admin/members` signed out redirect to sign-in.

## Not verified

- **The email in an inbox.** Production recorded `delivered: 1`, but nobody has confirmed it arrived and reads correctly (`.1`).
- **The dashboard and filters signed in on production** (`.2`). The logs show one production `/admin` render at 19:44 UTC with nothing but the Node warning, but not who loaded it or what it showed. Dev has no community activity, so the space rows were only ever seen at zero.
- **The preview button**, anywhere (`.3`).

## Found along the way

- **Production moved from Node 24 to Node 26 with #482** (`.4`). `engines: ">=24"` in `package.json` overrides the Project Settings' 24.x, and Vercel had just made 26 available. Nothing in #481 touched it, so any deploy that day would have done the same. CI and `.nvmrc` stay on 24, so production runs a Node major CI never exercises. Since then, every function cold start logs `ExperimentalWarning: localStorage is not available…` (Node 25+ web storage), which Vercel lists as its only runtime-error group. The proposed fix, PR #486 (pin `24.x`), came from a separate session.
- **The `dev` push CI run for `33f9d8f0` read "failure" with no failed step:** its `verify` job was never created, and GitHub was erroring at the time (the #481 merge took three attempts, the last through `gh api … /merge`). The next three `dev` pushes (`2b6970f3`, `47047f59`, `6ec9e367`) passed.

## Session notes

- Merging from this session: auto mode blocked `gh pr merge` on the record PR #483 until David wrote "You merge it" in chat; the same command then went through.
- The release record `.claude/releases/promote-2026-10-30.md` was committed before the first send. This close-out updates it with the send, the skip, the Node finding, and the note that #485 superseded its rollback target.
