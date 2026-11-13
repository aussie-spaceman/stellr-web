# Runbook: the Staff role

Staff is Stellr's role between Event Manager (a volunteer, one event) and Admin (the whole tenancy). It is for paid staff and for highly engaged volunteers who are essentially unpaid staff. Both are held to the same rules. Stellr only: no other tenant has Staff.

Code: `lib/staff.ts` (grants), `lib/authz/capabilities.ts` (what Staff may do), `lib/record-access-log.ts` (the access log). Design and decisions: `docs/AUTHZ.md` (Staff and capabilities), `docs/compliance/staff-role-review.md` (the research).

## What Staff can and can't do

| | Staff |
|---|---|
| Read the admin portal | Everything except view-as, Duties, the access console and privacy requests |
| Competitions | Events, rosters, check-in, emails, surveys, artwork, PD certificate and hours, refunds and payment changes, assigning Event Managers |
| Members | Member records, memberships, invites, schools, volunteers; entering a teaching license or an uploaded background check |
| Exports | As an admin: roster and member CSVs, Checkr reports, survey exports, signed agreements. Every one is logged |
| Never | Verifying or unverifying clearance, removing an uploaded check, adjudicating a background check, deleting or merging members, granting Staff or Admin, Duties, scholarship decisions, the store catalogue, Community and Academy changes, e-sign templates, email campaigns, the survey minor-agreement override |

## Before the first grant (once)

1. **Publish the Staff agreement.** Admin → Agreement documents, key `staff`. Upload the approved PDF and place the fields (name, email, signature, date). Until it is approved, no agreement can be sent and nobody can activate.
2. **Choose the Staff training module.** On any member page, under Staff → "Staff training module (for everyone)". It is an Academy module; every published lesson in it must be completed. Until one is chosen, nobody can activate.
3. **MFA in Clerk.** Staff turn on two-step verification on their own account page. Nothing to configure: Staff can't activate without it.

## Granting Staff

1. Open the person's member page. They need an email address and, to activate, a Stellr login and a date of birth showing 18+.
2. Under **Staff**, choose **Grant Staff**. They are emailed the checklist, and the Staff agreement is sent (the panel says if it couldn't be).
3. The checklist shows what is still missing. Staff starts **on its own** once all five are done: adult member with a login, cleared background check, signed Staff agreement, completed Staff training, MFA on. You don't need to come back.
4. If something was fixed outside the usual flow, choose **Check again**.

A grant runs 3 years from when it starts, and never past the background check's, agreement's or training's expiry. They are reminded 60 and 30 days before it ends. To keep Staff, grant it again: they sign the agreement and refresh the training.

## When something lapses

If a prerequisite stops holding (MFA turned off, the background check expires or is not cleared, the agreement or training lapses), Staff **pauses at once**: the role is removed, every session ends, and they are emailed. It comes back on its own when the prerequisite is restored. The daily `membership-expiry` cron is the backstop for anything a hook missed.

## Removing Staff (leavers)

On the day someone leaves, or stops volunteering:

1. Member page → Staff → **Remove Staff**, and give the reason. Access ends now: the role is cleared (back to Event Manager if they still manage an event in force) and every session is ended.
2. They are emailed, and reminded to delete any Stellr data held outside the platform, as the Staff agreement requires.
3. Remove any console seats they had (Google Workspace, Supabase, Vercel …) and any duty on `/admin/duties`.

## Reviews

- **Weekly (Friday digest, "Staff access"):** grants waiting on a prerequisite, access ending within 60 days, the week's exports by role, and anyone who opened more than 60 minors' records in the week. Look at any name in that last list.
- **Quarterly (the first Friday digest of January, April, July and October):** every active Staff grant. For each, confirm they still need it; remove anyone who doesn't.
- **Annually:** the information security program review (`docs/compliance/information-security-program.md`), including the accepted export risk.

## Where things are recorded

| What | Where |
|---|---|
| Grants, status, what is missing | `staff_grants` |
| The training module | `staff_role_settings` |
| Every grant, activation, pause, removal, expiry | the member's activity log, and the audit chain when `PLATFORM_AUDIT_ENABLED` is on |
| Views of minors' records, roster views, exports | `record_access_log` (append-only, IDs only) |

## Before production (owner)

- Count production Clerk users with `publicMetadata.role = 'staff'` before promoting phase 1: anyone holding it would get portal access. Dev had none.
- Apply the migrations to production before the code, outside event hours: `20261113120000`, `20261113200000`, `20261113210000`, `20261114090000`.
- Decide on `PLATFORM_AUDIT_ENABLED` (unset on both Vercel projects today).
- Drop the compatibility views `staff_roles` and `event_staff_check_ins` one release after the rename reaches production.
- Open: a purge job for `record_access_log` (3 years) and ended `staff_grants` (7 years); both tables refuse ordinary deletes.
