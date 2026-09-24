# Handover — admin-created members: invite to complete account (24 Sept 2026)

TRACKER: Session 15 (items 15.0–15.9). Google Doc snapshot:
`1WO0_cRbk_oz8i8tYYThwylZeaQOhWST4VGc8eFaBHhI`.
Code: PR #181 → `dev` as `845203b`; promoted in #183 (`e2a99e3`) by a separate session.

## What was asked

1. `/admin/members/new` showed "Failed to create member" (Sophie Fleck, no DOB entered). Investigate and fix.
2. **Correction mid-session, which outranks the first ask:** a hand-created member must get an email about the
   new account, with a link to "complete their account" that collects the missing data (date of birth etc.).
3. Ship. Promotion was done in another session.

## Root cause

Prod Postgres log: `null value in column "date_of_birth" of relation "members" violates not-null constraint`.
`members.date_of_birth` and `members.gender` were NOT NULL since the baseline. The admin form and API treated both
as optional, and the route turned the DB error into a generic 500. The same constraint made the Clerk
`user.created` webhook's "no member row yet" insert (`app/api/webhooks/clerk/route.ts`) fail silently. It sets
neither field and does not check the insert's error.

The first fix in the session (make DOB required on the form) was **discarded** after the correction. It is not in #181.

## What shipped

| Piece | Where |
|---|---|
| DOB + gender become nullable; `account_invite_sent_at timestamptz` | `supabase/migrations/20260924120000_member_account_invite.sql` |
| `sendAccountInvite(db, memberId, { actorMemberId, force })`: find or create a passwordless Clerk user and link `clerk_user_id` (only if null), email, stamp, activity `account_invite_sent`. Never throws. Returns `{sent}` or `{sent:false, reason}`. 10-minute cooldown; no send once DOB and gender are set | `lib/member-invite.ts` |
| `accountInviteEmail({ firstName, email, url })`, link `${AUTH_APP_URL}/account/onboarding` | `lib/email.ts` (end of file) |
| `ensureClerkUser()` split out of `ensureClerkUserAndSignInToken()`; `AUTH_APP_URL` exported | `lib/clerk-provisioning.ts`, `lib/env.ts` |
| Create route: `send_invite` defaults to true; invites only when DOB or gender is missing; returns `invite` | `app/api/admin/members/route.ts` |
| Re-send: 404 / 409 complete / 429 cooldown / 502 send failed | `app/api/admin/members/[id]/invite/route.ts` |
| Add Member "Invitation" checkbox (replaces "No Clerk account needed") | `components/admin/AdminAddMember.tsx` |
| Member detail: Send/Resend invite + "Profile incomplete" line, only while DOB or gender is missing | `components/admin/AdminMemberDetail.tsx` |
| `CommunityMember.needsOnboarding` (false during admin view-as); Home, Community layout and Account redirect to `/account/onboarding` | `lib/community.ts`, `app/(member)/home/page.tsx`, `app/(member)/community/layout.tsx`, `app/(member)/account/page.tsx` |

## What was proven, and how

- **Local run** against dev Supabase with Clerk test keys and email suppressed, using Playwright with the `e2e/.auth/admin.json` session:
  - The member was created with no DOB: 201, `invite.sent:true`.
  - A dev SQL read showed a null DOB and gender, the login linked, the stamp set and one activity row.
  - The Resend button returned 429 (cooldown).
- **CI on #181:** every step of run 36048832343 succeeded, including Build and `npx playwright test`.
- **Prod after promotion:**
  - Sophie Fleck was created at 20:39:17Z with no DOB (gender was entered).
  - `clerk_user_id` is linked, and `account_invite_sent_at` was stamped at 20:39:18Z.
  - There is one activity row and 2 `member_roles` rows, so the prod Clerk webhook fired.
- **Prod ledger:** `npm run db:status -- --prod` shows nothing pending, so 20260924120000 is recorded under its own name.
- **Prod Clerk sign-in settings:** `GET https://clerk.stellreducation.org/v1/environment` shows email `first_factors: ['email_code']`, plus Google and Discord OAuth. A login with no password can sign in, so the email's "use <email> to sign in" is true.

## Not proven — read these first

- **15.1 (HIGH): the member half.**
  - Nobody has yet gone from email link → sign-in → `/account/onboarding` → submit.
  - Onboarding POST updates the row found by `clerk_user_id` (`app/api/members/onboarding/route.ts`). The admin's `event_role` pre-fills the form.
  - Sophie Fleck (`sophiefleck926@gmail.com`) is the first real case. Read her row: once `date_of_birth` is not null, the member half is proven.
- **15.2: delivery.** The stamp only proves Resend returned 2xx. Check the Resend dashboard.
- **15.8: behaviour change.** Self-serve sign-ups now get a member row from the webhook before onboarding. Before this, the insert failed and onboarding POST created the row. `needsOnboarding` covers the redirect, but it has not been observed in prod. Past failed inserts may have left Clerk users with no member row.

## Known gaps left deliberately

- **15.6:** the admin route and `AdminAddMember.ageFromDob` work out age by year subtraction.
- **15.7:** every `isMinor` helper returns false for a null DOB:
  - `lib/access-gates.ts`, `lib/compliance.ts`, `lib/credentials-core.ts`, `lib/docusign.ts`, `lib/event-admin.ts`, `lib/onboarding-requirements.ts`.
  - The UI gate covers only Home, Community and Account.
  - Open decision: fail closed on unknown DOB, or gate at the `(member)` layout (a layout can't see the pathname, so onboarding needs an exemption).

## Housekeeping owed (David)

- **15.3:** dev ledger row `20260924192237` should be `20260924120000`. The UPDATE was blocked in auto mode.
- **15.4:** the main checkout `stellr-web` holds uncommitted copies of the 15 files, identical to dev. Run `git stash -u && git pull --ff-only && git stash drop`.
- **15.5:** dev test member `invite-check-1790277948136@example.com` (`67edb158-7c24-43b4-977a-a2243d8c56b1`) and its Clerk dev user.
