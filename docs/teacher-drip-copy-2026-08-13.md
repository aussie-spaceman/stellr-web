# Teacher welcome sequence — copy to paste into `/admin/email`

Companion to `docs/PLAN-teacher-onboarding-2026-08-13.md`.

Five emails. The **day 0** confirmation is transactional and ships in code
(`lib/registration-notify.ts`) — it is listed here only so the sequence reads as a
whole; do **not** create a campaign for it, or teachers get it twice.

Days 2 / 7 / 14 / 30 are marketing: create one template + one event campaign each,
all bound to event **`member.created`**, with the stated **Send after** value and
sequence key `teacher-welcome`. Set the audience to **Educator** tier so the
sequence never reaches students or parents.

Merge fields available: `{{firstName}}`, `{{lastName}}`, `{{fullName}}`,
`{{email}}`, `{{membershipId}}`, `{{tier}}`. `{{firstName}}` falls back to
"there", so a blank name still reads correctly.

Voice check (VOICE.md): educators get practical value, respect for their
expertise, and awareness of their time. No edtech sales-speak, no convincing them
to care about students.

---

## Day 0 — account confirmation *(transactional, already in code)*

**Subject:** Welcome to Stellr Education — your account is live

Sent by `sendAccountConfirmation` the moment onboarding completes. Names the tier
and the Spaces it opens, links to `/spaces` and `/home`, and invites a reply.
Goes to every new member regardless of marketing consent.

---

## Day 2 — what your membership already opens

- **Send after:** 2 days · **Sequence:** `teacher-welcome` · **Audience:** Educator tier
- **Subject:** What your Educator membership already opens

> Hi {{firstName}},
>
> Your Educator membership is active, so everything below is already unlocked —
> there's nothing to activate or upgrade.
>
> **The Educator Tier Space** is where the classroom-ready material lives: lesson
> plans, student worksheets, and the slide decks we use at our own events. Most of
> it is built to drop into a single period without prep.
>
> **The Teachers' Room** is the staff-room equivalent — other educators running
> the same programs, plus our team when you need an answer from us.
>
> Open your Spaces: {{appUrl}}/spaces
>
> If something you expected to see isn't there, reply and tell us. We'd rather
> hear it early.
>
> — The Stellr team

---

## Day 7 — the competition calendar

- **Send after:** 7 days · **Sequence:** `teacher-welcome` · **Audience:** Educator tier
- **Subject:** Our competition calendar, and how teachers usually start

> Hi {{firstName}},
>
> Most teachers start with one competition rather than a whole program, so here's
> the calendar and roughly what each one asks of you.
>
> Space Design Challenges run as one-day team events — students design a settlement
> against a real engineering brief, and you supervise rather than teach. Teams are
> typically 6–12 students, and no prior aerospace knowledge is needed on your side
> or theirs.
>
> See what's open: {{appUrl}}/events
>
> If you're weighing whether a particular event fits your cohort, reply with the
> year level and how many students you're thinking of. We'll tell you straight
> whether it's a good match.
>
> — The Stellr team

---

## Day 14 — registering a group

- **Send after:** 14 days · **Sequence:** `teacher-welcome` · **Audience:** Educator tier
- **Subject:** Registering a group takes about ten minutes

> Hi {{firstName}},
>
> When you're ready to bring students, the group registration flow is built so you
> don't have to chase individual sign-ups.
>
> You register the group, then send your students a single join link. They complete
> their own details and consent forms; you see who has and hasn't finished from one
> page. Schools that need an invoice rather than a card payment can choose that at
> checkout.
>
> Start a group registration: {{appUrl}}/events
>
> Two things worth knowing up front: students under 18 need a parent or guardian to
> complete the consent step, and you can add students after you register — the
> group isn't locked once created.
>
> — The Stellr team

---

## Day 30 — the community

- **Send after:** 30 days · **Sequence:** `teacher-welcome` · **Audience:** Educator tier
- **Subject:** The people behind the resources

> Hi {{firstName}},
>
> A month in — here's the part of Stellr that isn't a download.
>
> The **Teachers' Room** is where educators compare notes on what actually worked
> with a class, which is usually more useful than our own documentation. Our
> **mentors** are working engineers and scientists who join sessions to answer
> student questions directly; you can request one for your classroom.
>
> We also run live sessions through the year — some for students, some for
> teachers on running these programs.
>
> What's coming up: {{appUrl}}/spaces
>
> And if Stellr hasn't been useful so far, reply and tell us why. That's more
> valuable to us than a quiet unsubscribe.
>
> — The Stellr team

---

## Before activating

- [ ] Create the four templates, then the four campaigns (each starts as **draft**)
- [ ] Set audience → **Educator** tier on all four, and leave *Exclude minors* ticked
- [ ] Use **Preview recipients** on each to confirm the count is what you expect
- [ ] Send yourself a **Test** of each before activating
- [ ] Activate all four together, so a teacher can't land mid-sequence
- [ ] Replace `{{appUrl}}` above with the real link when pasting — it is **not** a
      merge field the engine resolves

> **Retro-send:** activating these does not reach anyone who registered earlier —
> `member.created` already fired for them. `mmmatlock@wcpss.net` and
> `janetsplanetofficial@gmail.com` need a personal email.
