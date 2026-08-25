# Handover — Clerk identity repair & onboarding question rules

**Session:** 25 Aug 2026 · **All code merged to `main` and deployed to production.**
**Commits:** `de9baf4`, `0efafdb`, `e49ed74` (production alias confirmed on `e49ed74`).

---

## What exists now

| Layer | State |
|---|---|
| **Clerk** `user_3ExgRb5mg9NtHXeDcCkcsx9k2U5` | primary = `david.shaw@stellreducation.org`, Google linked, `role: admin` |
| **Clerk** duplicate `user_3HYQE4RuMMepzoW54dVv35nVWgV` | **deleted** |
| **`members`** row `3bfe6a67…` | live, `david.shaw@stellreducation.org`, membership `0000134` |
| **Onboarding rules** | one shared module, `lib/onboarding-requirements.ts` |
| **Age resolution** | one exact check for the whole route |

### Key identifiers

```
Clerk user (real)     user_3ExgRb5mg9NtHXeDcCkcsx9k2U5
Clerk FAPI domain     clerk.stellreducation.org
Clerk instance size   33 users (only 1 was ever affected)
members row (David)   3bfe6a67-8f23-4601-90f2-56b4c5139dfe
Supabase project      hwtzpfrnksksxlwwabqz
```

---

## Part 1 — the authentication bug

**Symptom:** signing in with Google as `david.shaw@stellreducation.org` presented the
account as `david.shaw@insimeducation.com`.

**Root cause — two compounding problems, neither in app code:**

1. The Google account was renamed insim → stellr. **Clerk pins the email
   identification created at first OAuth sign-up and never renames it** when the
   provider's address changes. The account kept the old address as *primary*
   while `external_accounts[0].email_address` already read the new one.
   `<UserButton>` renders the primary — that mismatch was the whole bug.
2. **Clerk's user search cannot see external-account emails.** Both
   `?email_address=` and `?query=` were tested against the live instance and
   matched only the email identification. So `lib/clerk-provisioning.ts`
   (`getUserList({ emailAddress: [email] })`) missed the Google account on
   6 Aug and created a **duplicate Clerk user** holding the new address — which
   then owned the only `members` row, leaving the real admin account with none.

**Repair applied directly to production:** test `members` row deleted (FK dry-run
first — everything cascades), duplicate Clerk user deleted, new address POSTed
with `verified: true, primary: true`.

**⚠️ Clerk refused to delete the old address:** `delete_linked_identification_disallowed`
— *"This email address is linked to one or more Connected Accounts."* The user
had chosen to remove it entirely; that is **not possible while Google is linked**.
It remains as a harmless non-primary secondary. See open items.

**Confirmed working in production:** `members` row `3bfe6a67…` was created at
17:08 UTC by a real sign-in + onboarding, carrying the correct
`david.shaw@stellreducation.org`. The fix is verified by live data, not inference.

---

## Part 2 — onboarding question rules

**Symptom:** picking *Mentor / Volunteer* demanded a grade and a school.

**Cause:** the role card carries the **college** bracket (a mentor is often a
college student) and both the wizard and the API derived "is this a student?"
from the bracket alone.

**The trap that shaped the fix — rules are enforced in TWO places:**
`components/member/OnboardingForm.tsx` decides what to *ask*;
`app/api/members/onboarding/route.ts` decides what to *reject*. They were
hand-mirrored copies. Change one only and the member hits a 400 for a field the
wizard never showed, with no way out. They now share
**`lib/onboarding-requirements.ts`**, which returns `'hidden' | 'optional' | 'required'`
per field — *asked* and *mandatory* are deliberately separate concepts.

### The rule matrix as shipped

| Role | grade | t-shirt | school | emergency |
|---|---|---|---|---|
| Student (High School) | required | required | required | required |
| Student Manager | required | required | required | required |
| Mentor / Volunteer | – | required | optional | required |
| Teacher / Educator | – | – | required | – |
| Parent / Guardian | – | – | optional | – |
| College tier (role step skipped) | required | required | required | required |
| `/volunteer` flow | – | optional | optional | optional |
| **any minor by DOB** | required | (by role) | (by role) | required |

### Age resolution unified (`e49ed74`)

`route.ts` held **two disagreeing age checks**: an exact eighteenth-birthday date
for the volunteer 18+ gate, and a crude `thisYear - dobYear` for
`resolvedBracket`/`resolvedRole`. The crude one calls someone 18 from the January
of their eighteenth year, so a 17-year-old born in December kept whatever adult
role they picked instead of resolving to a high-school participant — a minor
filed as an adult. Both now use `isMinorDob` from the shared module.

**Audited for damage: none.** Only 7 members have a DOB, none are minors, and the
crude/exact disagreement window is empty. No backfill required.

**Behaviour change to watch:** more people now resolve to
`participant`/`high_school`, which feeds membership grants. Late-in-year
17-year-olds will land on a different tier than they would have before.

---

## ⚠️ Open item — stale hidden fields are still submitted

**Evidenced in production, not theoretical.** Member row `3bfe6a67…` is an
`adult` / `parent` carrying `grade: college_sophomore` and `tshirt_size: M`.

Cause: the wizard keeps `form.grade` / `form.tshirt_size` in state when a role
change *hides* those inputs, and `handleSubmit` posts the whole `form` object.
Filling them as a Mentor, then switching to Parent / Guardian, submits the
orphaned values. The API does not reject them because its rules only say what is
*required*, never what is *forbidden*.

This session fixed the equivalent hole for the **emergency contact** only — the
all-or-nothing guard deliberately covers `'hidden'` as well as `'optional'`:

```ts
if (required.emergencyContact !== 'required' && ec.any && !ec.all) { … 400 … }
```

**Grade and t-shirt size have no such guard.** The fix is symmetrical: null a
field on submit (or reject it) when its rule is `'hidden'`. Best done in
`route.ts`, so it holds for every client.

The one bad row is David's own. **Do not guess its correct value** — he may have
intended to register as a Mentor rather than a Parent.

```sql
-- only after confirming which role he actually wants
UPDATE members SET grade = NULL, tshirt_size = NULL
WHERE id = '3bfe6a67-8f23-4601-90f2-56b4c5139dfe';
```

---

## Other open items

| Item | Detail |
|---|---|
| **Old email cannot be removed** | Requires disconnecting Google, deleting the address, then re-linking **from inside the signed-in session** (Manage account → Connected accounts). Never by signing out and using "Sign in with Google" — with the address freed, that can spawn another duplicate. Email-code sign-in is enabled instance-wide and the new address is verified, so there is a working fallback factor. |
| **Duplicate-account trap is still live** | `lib/clerk-provisioning.ts` will create a duplicate for anyone whose OAuth email ≠ their Clerk email. Clerk's API cannot search external-account emails, so no cheap guard exists. Detect by listing users and comparing each `external_accounts[].email_address` against that user's `email_addresses[]`. |
| **Admin forms show Grade for college bracket** | `AdminAddMember`, `AdminMemberDetail` — cosmetic, optional there, not blocking. |
| **`GOOGLE_SHEET_OWNER_EMAIL` unset in production** | Falls back to the hard-coded `david.shaw@insimeducation.com`. **Deliberate** — it is a Drive ownership/impersonation identity, not a mail sender (see `lib/google-sheets.ts` and `docs/PLAN-single-email-domain.md`). Repointing it breaks existing group spreadsheets. Left alone; unverified whether impersonation still resolves after the Google rename. |

---

## How to verify the wizard without an auth session

The onboarding page is behind Clerk, and the only account in the relevant state
belongs to David. Render the component in the repo's **Storybook** instead:

```
components/**/*.stories.tsx          # already in .storybook/main.ts globs
parameters: { nextjs: { appDirectory: true } }   # or useRouter throws
npx storybook dev -p 6006 --no-open --quiet
```

The browser pane reports `innerWidth: 0` against Storybook and will not resize,
so **coordinate clicks and screenshots are useless** — drive the DOM through
`javascript_tool` and read state back. Use the native value setter plus a
bubbling `input`/`change` event, or React ignores the write:

```js
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
  .set.call(el, v)
el.dispatchEvent(new Event('input', { bubbles: true }))
```

Observed this way and worth re-checking after any change: with an adult DOB
Parent / Guardian shows 2 steps and no grade; typing a minor DOB adds the grade
field, grows the wizard to 3 steps and turns *Complete profile* into *Continue*;
reverting the date puts it back with no stuck state.
