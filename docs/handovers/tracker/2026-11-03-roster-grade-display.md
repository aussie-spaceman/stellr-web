# Roster grade display — 2026-11-03

Slug: `roster-grade-display`. Handover: `HANDOVER-roster-grade-display-2026-11-03.md`. Doc snapshot: `19A2C0Rhea39tLH_11X_4iXhx8rNNAXkjf1wUV2zCLVc`.
PR #498 → `dev` as `1487d95b`; not promoted. Migration: none.

The admin event roster and its CSV export show grades as a bare number whether `participants.grade` holds `10` or `grade_10` (`displayGrade` in `lib/member-enums.ts`). Stored values are unchanged.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| roster-grade-display.1 | Promote to production | On `dev` (`1487d95b`) only; not in a promotion PR yet | Include in the next `/promote` | ☐ |
| roster-grade-display.2 | See a real roster show numbers only | Not looked at in any browser; CI e2e does not cover the grade cell | After promotion, open the Nevada roster tab and check the Grade column | ☐ |
| roster-grade-display.3 | Store one grade shape in `participants.grade` | Individual form writes `10`; group + group-join copy `grade_10`. Display-only fix shipped | David to decide: normalise on write + backfill migration, or leave display-only | ☐ |
| roster-grade-display.4 | Other grade readers use `displayGrade` | Team spreadsheet (`app/api/registrations/[id]/spreadsheet`) still raw; `EventTeamProfiles` has its own inline regex | Route both through `displayGrade` in a small PR | ☐ |
