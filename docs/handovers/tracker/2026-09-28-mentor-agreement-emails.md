# Mentor agreement emails indistinguishable — 2026-09-28

Slug: `mentor-agreement-emails`. Handover: `HANDOVER-mentor-agreement-emails-2026-09-28.md`. Doc snapshot: `1ZKNYkSFtG0EoTgbv6VZXOEyzR7I4mofNeXPnXb25jw8`.
PR #241 → `dev` as `ed475c9`; promoted in #242 (`4b197c7`). Migration: none.

Mentor and Stellr counter-signer now get distinct DocuSign subjects (`Your signature: …` vs `Stellr counter-signature: …`). Live in prod as `dpl_HzM333Uc1YAxacFPGwSpCBYgTRW4`; applies only to envelopes issued after 22:10Z on 28 Sept.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| mentor-agreement-emails.1 | Pauline, Sophie and Patrick mentor signatures | All three envelopes are at 1 of 2 with the Mentor still `sent` (prod read, 28 Sept ~22:15Z). They still carry the old identical subject. David is chasing them manually. | Re-read the Mentor recipient rows on 1 Oct. Anything unsigned is David's call before 3 Oct. | ☐ |
| mentor-agreement-emails.2 | Per-role subjects in a real inbox | In prod and pinned by a unit test. No mentor envelope issued since the deploy. | On the next mentor/volunteer issue, confirm the two emails arrive with different subjects and are not threaded together. | ☐ |
| mentor-agreement-emails.3 | David's own mentor agreement | `cc25fb6c` `completed` 2/2; Mentor signed 21:48:42Z (prod read). | — | ☑ |
| mentor-agreement-emails.4 | Fix shipped to prod | #242 merged `4b197c7`; deployment READY for that SHA; www 200, app 307, cron 401. | — | ☑ |

## Closes

- `22.2` (**partly; not closed**): the webhook half is proven in prod. Envelope `cc25fb6c` (`volunteer`, `volunteer-program`) is `completed` with `completed_at` 2026-09-28 21:49:04Z. Still unchecked: admin card Complete with valid-until +3y, and the event panel showing "Agreement signed". 22.2 stays open with its author.
