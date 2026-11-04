# Handover: member merge, school email, staff roster add (4 Nov 2026)

**#520 is on `dev` and not promoted; another session promotes it.** Everything else below is live.

Tracker: `tracker/2026-11-04-member-merge-school-email.md`. People are by role and `members.id`; names are in the Doc.

## Context
A student manager added a student (`6f645a63-bcda-4804-b358-454f559f8453`) whose school address blocked the consent form, removed them, and re-added them under a personal address. That left two member records and no roster row. The owner asked for a merge tool and a personal + school email pair.

## What changed
| PR | What | Where |
|---|---|---|
| #512 | Merge tool (`public.merge_members`, `lib/member-merge.ts`, `/api/admin/members/merge`, `MemberMergeDialog`). `school_email` on members and participants; `MemberEmailFields` on the forms; School Email as sheet column R; `upsertMember` and the registration routes also match by the other address. | Live |
| #517 | Shared `lib/group-participant-add.ts`; `POST /api/admin/registrations/[id]/participants`; Add participant on the admin roster; the `school_name` fix. | Live |
| #520 | `adoptOpenEnvelope` relinks a live form when someone is added back; Reissue finds it before asking to spend an envelope; plain wording; Fix guardian email can send with an unchanged address. | **`dev` only** |
| #515, #518 | The promotions. #515 also carried #508–#511 and #513. | Live |

## Owner decisions
- The pair shows **under 18** (original ask: 18 or younger). At least one address required. Nothing goes to the school address while a personal one exists.
- Merge keeps the older record, swappable. Conflicts take the record updated most recently. No snapshot of the removed record: its `audit_log` rows are deleted too.
- Admins only for merging. Staff add follows the roster's other group actions: admins and that event's managers. That second rule was my call, not the owner's.
- Promoted #508–#513 despite the S3 and S4 release gates, after being shown them.

## Traps found
- **The organiser's Add participant failed on every new entry since June.** `participants.school_name` is NOT NULL and the form never sent one. The member row was written first, so each try left a member with no roster row. That this caused the 4 Nov duplicate is inferred: the production logs had expired, and the signature matches and reproduced on dev.
- **Removing a participant clears `agreements.participant_id`**, while the envelope stays live. The roster reads by participant, so it shows Not Issued whatever the real state.
- `prod-migrate.yml` is not on `main` until it is promoted in a release, so it could not run; `docs/RUNBOOK-agent-controls.md` line 68 covers that gap. It now is on `main`.
- Auto mode blocks merging a PR into `dev` without an instruction in the conversation.

## Not verified
Rows .3 to .7 and .13 to .14. Also: Reissue's re-send has never run against a real envelope through the new link, and the guardian route's new behaviour has no automated test.

## Known wrong record
The student's history has "New DocuSign issued … (in_flight)" from 4 Nov, though nothing was sent. #520 stops new ones; this entry stays.

## Corrections to what I told the owner
I said the Nevada group owed its fee and had not paid. That came from `amount_due_cents` and a null payment intent, and the roster's pills disagree. See row .13.
