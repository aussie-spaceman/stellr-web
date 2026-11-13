# Staff role: leading practice and legal review (13 Nov 2026)

The research behind the Staff role (`docs/RUNBOOK-staff-role.md`, `lib/staff.ts`). This is research, not legal advice: items marked **(to confirm)** need counsel or a check against the primary text.

**The setting:** one Next.js app serving several tenants, with Clerk sign-in and Supabase Postgres. It holds personal data of minors (K-12, some under 13), parents, teachers, schools and emergency contacts, plus Stripe payments, across several US states. Staff are paid staff or highly engaged volunteers. They read the whole admin portal and change Competitions and Members, after signing a Staff agreement.

## 1. Access control design

**Sources:** OWASP Authorization and Multi-Tenant Security cheat sheets; OWASP ASVS 5.0 V8; NIST SP 800-53 AC-2, AC-5, AC-6 and AU-9; CIS Controls v8 5 and 6; NIST SP 800-63B-4.

- **Name capabilities, not a role ladder.** Staff is a named set, not "admin minus X". A new admin feature therefore stays admin-only until it is added to Staff on purpose.
  - Built as `lib/authz/capabilities.ts`.
- **Deny by default, and decide on the server for every request.** The UI only hides things.
  - Built: every admin route checks a capability.
  - Built: `test/staff-route-matrix.test.ts` fails if an admin-only area accepts a Staff capability.
- **Separation of duties.** Staff can't grant privilege or clear people. Otherwise one person could clear an accomplice and then give them access.
  - Built: verify, adjudicate, grant Staff and Duties all stay admin-only.
- **A platform role in a multi-tenant app.** Staff is pinned to Stellr and held server-side (the Clerk claim plus the `staff_grants` row). A `staff` membership in any other tenant grants nothing.
  - Built: `decide.ts`.
- **Time-boxed and reviewed.** Same-day removal for leavers, plus quarterly access reviews.
  - Built: a 3-year term with 60- and 30-day reminders.
  - Built: removal ends every session.
  - Built: a quarterly review list in the digest.
- **Strong authentication.** MFA for privileged roles.
  - Built: MFA is a prerequisite, read from Clerk.
  - NIST 800-63B-4 suggests reauthenticating at least every 24 hours and an idle timeout of 1 hour or less. Clerk sets session lifetime for the whole instance, so a per-role limit is open **(to confirm the Clerk plan tier)**.
  - Step-up re-verification on exports was offered and declined: an accepted risk, recorded in the security program.

## 2. Audit logging

**Sources:** OWASP Logging Cheat Sheet; NIST AC-6(9) and AU-9.

- **Log reads of minors' records, not just writes.** Every export too. Record who, what (by ID) and when; never the personal data itself.
  - Built: `record_access_log`, IDs only.
- **Append-only, out of reach of the people being logged.**
  - Built: a trigger, plus a revoke even from the service role.
- **Review it.** Flag unusual volume.
  - Built: the digest names anyone opening more than 60 minors' records in a week (threshold to tune).
- **Retention:** no US statute fixes a period for access logs. Set to 3 years, the Staff term.

## 3. US law

### COPPA (amended rule, compliance from 22 Apr 2026)

- **§312.8 written information security program:**
  - a named coordinator;
  - an annual risk assessment that includes internal risk;
  - safeguards;
  - testing and monitoring;
  - an annual re-evaluation.

  Staff insider risk and these controls are recorded in `information-security-program.md`.
- **§312.10 written retention policy:** see `retention-schedule.md`, rows 35 and 36.
- **Whether COPPA applies** depends on whether Stellr has actual knowledge of under-13s through its sign-up flows **(to confirm)**.

### FERPA

- FERPA reaches Stellr only where schools disclose education records to it.
- If they do, the "school official" exception covers volunteers and contractors under the school's direct control, with a legitimate educational interest, and no onward disclosure.
- Whether Stellr receives education records, and needs written school agreements, is **(to confirm)**.

### State student-privacy laws

- **Minnesota §13.32 (2022):** provider staff may access data only as their duties require.
- **Nevada NRS 388.281–.296:** a data-security plan is required.
- **Nevada NRS 603A:** reasonable security and breach notice.
- **California SOPIPA;** **Illinois SOPPA** if Illinois schools are served.
- Whether Stellr is an "operator" or "technology provider" under these laws is **(to confirm)**.
- **Breach-notice laws** in every state where events run. A misusing insider is a breach, and the access log is what scopes it.

## 4. Safeguarding

- **Screening:** screen everyone with access to minors' data, paid or unpaid, with layered checks.
  - Built: a cleared background check is a prerequisite, re-checked continuously and valid 3 years.
  - Nevada NRS 432A.710 (rescreening every 5 years for recreation programs) may or may not cover Stellr events **(to confirm)**.
- **Communication:** MAAPP-style rules, which belong in the Staff agreement:
  - no private one-to-one contact with minors;
  - never use platform data for personal contact;
  - messages to families go through Stellr.
- **Mandated reporting:** training for the states where events run. This belongs in the Staff training module.

## 5. Volunteers with privileged access

FERPA's "school official" and HIPAA's "workforce" both include volunteers, and the settled norm is to treat them exactly like employees.

- Built: Staff makes no distinction between paid and unpaid.

## 6. What the Staff agreement should contain

This is for the drafter (the text is being written outside the repo).

1. **Confidentiality,** which survives the role.
2. **Acceptable use:**
   - data stays on the platform;
   - no copies to personal devices or accounts;
   - no shared credentials.
3. **Need-to-know only;** no commercial use.
4. **A safeguarding code:**
   - no private one-to-one contact with minors;
   - open and transparent communication;
   - photo and image rules.
5. **Consent to background checks and rescreening.**
6. **A duty to report incidents and suspected abuse,** with a timeframe and named contacts.
7. **MFA and device security.**
8. **Notice that access is monitored and logged.**
9. **On leaving:** return or destroy data, and confirm it in writing.
10. **Consequences of a breach.**
11. **Re-signing every 3 years,** the Staff term.

## 7. Comparable products

- **Stripe:**
  - Roles are grouped by job (View only, Support, Analyst, Refund analyst …).
  - Combined roles get the union of their permissions.
  - View only includes exports there. For minors' data, Stellr logs every export instead.
- **Clerk:** organisation roles suit tenant users; a platform role like Staff sits outside organisations.
- **Supabase:** permission checks belong in row-level security where the database client carries the user's token. Stellr's admin routes use the service role, so the checks are in the app and pinned by tests.

## Open questions for counsel and the owner

1. Which sign-up flows give COPPA actual knowledge of under-13s.
2. Whether Stellr receives FERPA education records, and needs school agreements.
3. Operator or provider status under SOPIPA-style laws in Minnesota, Nevada and California.
4. Whether NRS 432A.710 covers Stellr events or volunteers.
5. Per-role session lifetime and idle timeout in Clerk.
6. Step-up re-verification for Staff exports (declined for now).
