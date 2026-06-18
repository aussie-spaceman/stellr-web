# Seed — local/staging data matching the redesign mockups

Two files populate a dev environment with the exact content shown in `Stellr Design Review.dc.html` (Avanee Kapoor, the Lunar Settlement Challenge, Team Aurora, Aerospace Design space, training with progress, mentoring sessions, cohort chat).

| File | Target | What it creates |
|---|---|---|
| `seed.sql` | Supabase (Postgres) | members, school, directory opt-ins, community spaces + posts + comments, training modules/sections/items/progress/enrollments/assignment, mentoring cohort + sessions + cohort chat, and an event registration + participant. |
| `sanity-event.ndjson` | Sanity dataset | the `event` document the registration/assignment join to (slug `lunar-settlement-challenge`, `_id` `event-lunar-settlement`). |

## Run order

### 1. Migrations first
Apply all `supabase/migrations/*` to your dev DB (`supabase db push` or your usual flow).

### 2. Supabase seed
```bash
psql "$SUPABASE_DB_URL" -f design_handoff_app_redesign/seed/seed.sql
# or paste seed.sql into the Supabase SQL editor (dev project only)
```
Idempotent (fixed UUIDs + `ON CONFLICT DO NOTHING`) — safe to re-run.

### 3. Sanity event
```bash
# from repo root, with Sanity CLI configured for your dev dataset:
npx sanity dataset import design_handoff_app_redesign/seed/sanity-event.ndjson <your-dataset> --replace
```
Or recreate it by hand in `/studio`: an **Event** with title "Lunar Settlement Challenge", slug `lunar-settlement-challenge`, Activity Type **Live Event**, date **~2 weeks out**, city Phoenix, state AZ, Registration Open.

> **Update the date.** `sanity-event.ndjson` ships `date: 2026-07-01`. Set it to roughly **two weeks from today** so Home's "in N days" countdown and the 12-month catalog window behave. The SQL uses relative `now() + interval` already, so only the Sanity date is hard-coded.

## Two required hookups

1. **Point Avanee at your Clerk user.** Home and all personalized data load for the member whose `members.clerk_user_id` matches your signed-in Clerk user. Either:
   - edit `seed.sql` and replace `'seed_clerk_avanee'` with your Clerk dev user id **before** running, or
   - after running: `UPDATE public.members SET clerk_user_id = '<your_clerk_user_id>' WHERE email = 'avanee.seed@example.com';`
   Find your id in the Clerk dashboard (Users) or from `auth()` in a dev log.

2. **Sanity must be reachable** with the env vars in `.env.local` (project id, dataset, token) or `getMemberEvents`/the catalog return empty and the Home hero shows its empty state.

## What each screen will show after seeding (signed in as Avanee)
- **Home:** next event "Lunar Settlement Challenge" (~12 days), prep 2/4, EDP training 60% + Presenting 20%, two upcoming mentoring sessions, recent posts from Jordan & Sara (Mentor).
- **Spaces:** Aerospace Design (3 recent posts), Ask an Engineer (announcement pinned), Showcase (locked — Avanee is free tier), Off Topic.
- **Academy → Training:** EDP (curriculum, mandatory, 60%), Presenting to Judges (CTE, 20%), Intro to CAD Modeling (library, 0%).
- **Directory:** 6 opted-in members across Lincoln High / AZ.

## Notes / gotchas
- `members.material_kind = 'curriculum'`: if your `training_modules` CHECK predates the `curriculum` value, run the `ALTER … ADD CONSTRAINT` shown inline in `seed.sql`.
- `participants.membership_id` is system-generated (omitted in the insert). If your schema makes it `NOT NULL` without a default/trigger, add a value or relax it on dev.
- If `members`/`participants` have extra `NOT NULL` columns without defaults on your branch, introspect (`\d public.members`) and add them — the seed covers the columns referenced by the member-app queries.
- Don't run against production. Emails are `*.seed@example.com` and clerk ids are `seed_clerk_*` to make cleanup easy: `DELETE FROM public.members WHERE email LIKE '%.seed@example.com';` (cascades to seeded child rows).
