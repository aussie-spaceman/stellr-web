# Data protection assessment: minors' personal data

Status: draft for owner approval, 2 Oct 2026. Owner: David Shaw (to confirm).

This assessment covers how Stellr processes the personal data of participants under 18, including under-13s, across registration, the member platform and signing (DocuSign and Stellr's own signing system). It is framed for the Colorado Privacy Act as amended by **SB 24-041** (protections for minors' data) and for **COPPA**. It is not legal advice; items marked **(to confirm with counsel)** need a lawyer's view.

## 1. Does the law apply? (to confirm with counsel)

- **Colorado Privacy Act (CPA).** Unlike several other states' privacy laws, the CPA has no general exemption for nonprofits (to confirm with counsel). Its main duties apply only above volume thresholds (personal data of 100,000 Colorado consumers a year, or 25,000 with revenue from data sales). Whether SB 24-041's minors' duties apply below those thresholds is **(to confirm with counsel)**. Data a school shares that is covered by FERPA may fall outside the CPA **(to confirm with counsel)**.
- **SB 24-041** (in force 1 Oct 2025) applies to a controller offering an online service, product or feature to someone it actually knows, or wilfully disregards, is under 18. Stellr knows participants' dates of birth, so if the CPA reaches Stellr, these duties apply. They include: use reasonable care to avoid a heightened risk of harm to minors; do not process a minor's data for targeted advertising, sale, or certain profiling, or collect precise geolocation, without consent (a parent's for under-13s); do not use design features meant to significantly increase a minor's use; and carry out a data protection assessment like this one.
- **COPPA.** COPPA is enforced through the FTC Act, which does not reach most nonprofits **(to confirm with counsel)**. Stellr's Privacy Policy (§2, §12) nevertheless says Stellr complies with COPPA, so this assessment treats COPPA as a commitment Stellr has made.
- Stellr is Colorado-facing (Colorado events, Colorado breach-notice commitment in Privacy §11) and incorporated in Utah. Other states' student-privacy and children's-privacy laws may apply **(to confirm with counsel)**.

Approach: act as though SB 24-041 and COPPA apply, because the Privacy Policy already promises it and the cost of doing so is low.

## 2. Purposes

From Privacy §5 and School Data Terms §2. Minors' data is used to:

1. Register and manage participation in events and the community.
2. Check age eligibility and trigger parental consent.
3. Obtain and prove parental consent and agreements.
4. Keep participants safe at in-person events, now and at future events (medical and dietary).
5. Communicate about events and results.
6. Issue credentials, and publish results, names and photos unless a parent has opted out.
7. Aggregate reporting (ethnicity used only in totals).

Not used for: sale; targeted advertising; profiling with legal or similar effects; product development or testing (School Data Terms §2; plan Residual risk 8).

## 3. Data collected about minors

Identity and contact; school and grade; date of birth; gender; ethnicity (optional); T-shirt size; health conditions, allergies, dietary needs (sensitive); guardian and emergency contacts; account and login data (Clerk); signing records (typed or drawn signature, field values, IP address, browser, timestamps, audit trail); credentials; photos and videos; technical data. Full list and locations: `retention-schedule.md`.

## 4. Data minimisation

- Signing records are used only to prove the signature, never for analytics (Privacy §3.10, §8).
- A drawn signature is stored as an image only; no stroke timing, pressure or path (`lib/esign/native/signature-image.ts`).
- Checkr receives name, email and work location only (`lib/background-provider/checkr.ts`); reports are fetched at export time and never stored (`lib/background-report-export.ts`). Checks are for adults only.
- Unsigned requests are voided and their signing data deleted 30 days after the last link (`expireUnsigned`, `lib/esign/retention.ts`).
- Signed PDFs are never emailed; signers get a gated download (plan; `app/api/sign/copy/route.ts`).
- Storage paths hold no names (`archivePaths`, `lib/esign/storage.ts`).
- **Gaps:** `deletion_archive` keeps a full snapshot of deleted participants and members, including health data, forever (`lib/deletion/archive.ts`). Withdrawn participants are not deleted automatically. `members.marketing_consent` defaults to `true` for every member, minors included (baseline schema) — **(to confirm whether marketing email goes to under-18s by default)**.

## 5. The under-13 position (owner decision)

- Every minor signs, under-13s included, as with DocuSign today.
- On Stellr signing, the **guardian signs first**. The student's request is created and emailed only after the guardian completes (`activateNext`, `lib/esign/native/flow.ts`; Privacy §2). So no signature, IP address or device detail is collected from a child before a parent has consented.
- The guardian confirms the child's year of birth before seeing the document, and attests to being the parent or legal guardian before signing (`openLink`, `recordConsent`, `lib/esign/native/flow.ts`).
- DocuSign envelopes: guardian-first ordering depends on DocuSign routing order (to confirm for every DocuSign template).

## 6. Guardian identity: email link only (accepted residual risk)

The guardian is identified only by control of the email address given at registration, as with DocuSign. Stellr does not verify identity beyond that (no card check, ID check or call). The Privacy Policy no longer calls the consent "verifiable".

- **Risk:** a student can enter their own address as the guardian's and sign as their parent. That leaves no valid parental release, and under COPPA an email-only method is generally acceptable only for internal use, not for disclosure to others such as publishing photos or names **(to confirm with counsel)**.
- **Mitigations:** year-of-birth check; guardian attestation; Terms §4.2 says a form signed by someone who is not the parent is not valid consent; IP address and browser recorded for review after the fact; reminders to the guardian address; paper alternative on request (Terms §22).
- **Owner decision:** accepted, 2 Oct 2026 (`docs/PLAN-esign-2026-10-02.md`, Decisions and Residual risk 1). Sign-off below.

## 7. Photo and media release: opt-out (accepted residual risk)

The consent form includes the photo and media permission with a box to opt out. Opting out does not affect participation (Privacy §7.4; Terms §11.3). The opt-out is read back from the signed form (`getFieldValues`; `lib/docusign-optout.ts`).

- **Risk:** opt-out is weaker than opt-in for children's images; COPPA expects consent to disclosure to be separable from consent to participate. The separate opt-out box is how the form provides that.
- **Mitigations:** removal on request at any time; no identifiable images published of an opted-out participant.
- **Owner decision:** keep opt-out, 2 Oct 2026 (plan, Compliance requirements). Sign-off below.

## 8. No targeted advertising or trackers where minors sign

- Private routes (`/sign`, pay links, join links) load no Google Tag Manager, advertising tags, HubSpot, cookie banner or Vercel Analytics (`lib/private-routes.ts`, `app/layout.tsx`, `proxy.ts`).
- Registration and education records are never used for advertising (Privacy §5, §7.7; School Data Terms §2). Apollo.io runs only on educator and partner pages, with advertising consent (Privacy §9.2).
- Advertising tags elsewhere are off until consent (Google Consent Mode, `ConsentMode` in `app/layout.tsx`).
- No precise geolocation is collected; `Permissions-Policy` disables geolocation (`next.config.mjs`).
- No design features to extend minors' use were identified (no streaks, autoplay or infinite feeds) **(to confirm)**.

## 9. Retention

Signed agreements: 7 years from signing, then deleted (`purgeExpired`). Medical and dietary: on the member record for the life of the account, removable at any time. Full schedule: `retention-schedule.md`. Accepted residual risk: 7 years is shorter than a young participant's claim period (plan Residual risk 2).

## 10. Security

See `information-security-program.md`: fragment tokens, 30-minute session cookies, private-route headers, append-only audit trail, encrypted off-site copy, integrity checks, access log, admin-only downloads with no download under impersonation.

## 11. Risks and mitigations

| # | Risk to minors | Likelihood | Impact | Mitigation in place | Remaining action |
|---|---|---|---|---|---|
| 1 | Student signs as their own parent | Medium | High | Year-of-birth check, attestation, audit trail | Accepted (owner) |
| 2 | Guardian address mistyped; a stranger opens a child's form | Medium | High | Year-of-birth check, lock after 5 wrong answers, generic invalid-link text | None |
| 3 | Signing link leaks via referrer, logs or trackers | Low | High | Fragment token, no trackers, `no-referrer`, `no-store`, `noindex` | Add full script CSP |
| 4 | Health data exposed to other team members | Low | High | Team detail returns names and roles only to non-organisers (`app/api/members/teams/[id]/route.ts`) | None |
| 5 | Health data kept after deletion | High | Medium | None for `deletion_archive` | Build purge (README conflict 2) |
| 6 | Child's photo published despite parent's wish | Low | Medium | Opt-out read back from the form; removal on request | Accepted (owner) |
| 7 | Data loss (no database backups) | Medium | Medium | Nightly encrypted copy, restore drill | Accepted (plan Residual risk 5) |
| 8 | Signing email never arrives (Resend Free limit) | Medium | Low | Budget queue, guardians first, "Sign now" in account | Accepted (plan Residual risk 6) |
| 9 | Marketing email to minors by default | (to confirm) | Low | Unsubscribe link | Decide default for under-18s |
| 10 | Admin opens a restricted record | Low | Medium | Logged in `esign_access_log` | Review the log quarterly |

## 12. Residual risks accepted

1. Email-link-only guardian identity (§6).
2. Photo and media release as opt-out (§7).
3. Under-13s sign their own section after the guardian (§5).
4. 7-year retention shorter than some claim periods.
5. No counsel review of the FERPA position, School Data Terms and waiver wording (plan Residual risk 4).

## 13. Sign-off

| Role | Name | Decision | Date | Signature |
|---|---|---|---|---|
| Program owner | David Shaw (to confirm) | Approve assessment and accept residual risks 1–5 | | |
| Counsel review | (to confirm) | | | |

Review this assessment yearly, and before any new processing of minors' data (new form fields, new vendor, new public feature).
