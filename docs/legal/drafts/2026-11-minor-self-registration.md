# Draft for owner approval: minor self-registration (Terms §4.1, Privacy §2)

**Status:** DRAFT, not live. Written 3 Nov 2026 for plan S1 / decision 24 ("anyone can register; the controls are by age").
The live pages (`app/(public)/terms/page.tsx`, `app/(public)/privacy/page.tsx`) are unchanged.

**What approval switches on:** set `MINOR_SELF_SIGNUP_ENABLED=true` in Vercel (dev first, then production) at the same
time as these words go live. Until then onboarding keeps the 2 Oct 2026 behaviour: a minor finishes onboarding only
through an invite, an event registration or a consent envelope.

## What the code does with the flag on

| Age on the day they register | What happens |
|---|---|
| 18 or over | Registers at once, as today. |
| 13–17 | Registers, gives a parent or legal guardian's name and email (as their emergency contact). The guardian is sent the Participation Agreement — Student / Minor on Stellr signing. Until it is signed the account is **pending**: the student can read public content, their own profile and their own registrations; they cannot post, comment, chat, react, upload, contribute resources, join a Space, or appear in the member directory or @mention search. |
| Under 13 | Gives only a first name, date of birth and a parent's email (their login email is held by the sign-in provider). The parent is sent the same agreement. The account is **inactive** until the parent signs: no community (reading included), no member pages, no event or group registration, and no other profile field can be added. After consent: never listed in the directory or mention search, no direct messages (none exist), and no posting, comments or chat, because Stellr has no pre-moderated space yet. Reactions and joining a Space are allowed. |
| Date of birth missing or not a real date | Refused at the age screen. Anywhere a stored date is unreadable, the account is treated as under 13. |

- The age screen asks for the date of birth on its own, first, and does not mention any age threshold.
- A date of birth on file that says the person is a minor cannot be changed by them to an adult one.
- Marketing consent is set off for everyone under 18 at onboarding.
- Only **self**-registration is pending. A minor an adult brought to Stellr (an admin invite, an event or group registration, an event's consent form) keeps today's path: their event's own consent form, no pending state, no 30-day deletion.
- The 30-day clock starts when the date of birth is given on the age screen, so a sign-up abandoned there is deleted too.
- A pending request not signed within 30 days is deleted with the account, its data and its sign-in login, through the deletion registry, with no archive copy kept. An account whose parent has signed but whose student has not yet signed is not deleted, nor is one that has since been registered for an event.
- The parent or guardian confirms the child's year of birth and that they are the parent or legal guardian before signing (the signing flow already does both).

## Proposed Terms §4.1 — Who may use the Services

> Our Services are intended for users in the United States. Anyone may create a Stellr account. A "Minor" is anyone
> under the age of majority in their state of residence (18 in most states, 19 in Alabama and Nebraska, 21 in
> Mississippi), anyone still enrolled in high school, or anyone who is a ward of the state or under guardianship.
>
> When you create an account we first ask your date of birth. If you are a Minor aged 13 or over, you give us the name
> and email address of your parent or legal guardian, and we send them Stellr's Participation Agreement — Student /
> Minor. Until they sign it your account is pending: you can browse Stellr and manage your profile and registrations,
> but you cannot post, comment, chat or appear in the member directory, and you cannot take part in Stellr activities.
>
> If you are under 13, we ask only for your first name, your date of birth and your parent's email address, and your
> account stays inactive until your parent or legal guardian signs. Once they have, you can use Stellr with the
> protections in our Privacy Policy, Section 2.
>
> Pending accounts that do not receive consent within 30 days are deleted, with the information collected for them.
> You must give your true date of birth and cannot change it yourself once it is on file. A Minor may also be
> registered by an authorized school official (Section 4.3).

## Proposed Privacy §2 — replace the "Self-registration and pending accounts" paragraph

> **Self-registration and pending accounts.** Anyone may create a Stellr account; we first ask for their date of
> birth. When a Minor aged 13 or over registers, we also ask for their parent's or legal guardian's name and email
> address and send the parent or guardian the Participation Agreement. Until it is signed the account is pending: we
> use the information only to seek consent and to run the pending account; the student can see public content and
> their own profile and registrations, but cannot post, comment or chat in the community, is not shown in the member
> directory or to other members searching for someone to mention, and receives no marketing email. Event
> participation still needs each event's own consent, as today.
>
> When a child under 13 registers, before a parent consents we collect only the child's first name, date of birth and
> the email address they sign in with, and the parent's email address, and we use them only to ask for consent (COPPA,
> 16 C.F.R. §312.5(c)(1)). The account is inactive until the parent signs. After consent, a child under 13 is never
> listed in the member directory or mention search, cannot send direct messages, and can post only in spaces that are
> moderated before posts appear.
>
> If consent is not given within 30 days, we delete the pending account and all information collected for it,
> including the sign-in account, and keep no copy. We may take reasonable steps to confirm that the person consenting
> is the student's parent or legal guardian.

Also in Privacy §2, "Participants under 13": replace "the child's name, date of birth, and email address and the
parent's name and email address" with "the child's first name, date of birth and sign-in email address and the
parent's email address".

## Decisions for the owner

1. **Approve the wording above** (or edit it). Nothing goes live until you do.
2. **Under-13 consent method.** The default built is e-sign: the parent receives the form at the email the child gave,
   confirms the child's birth year and that they are the parent, then signs. The FTC's listed methods for verifiable
   parental consent include a signed consent form returned electronically; whether an emailed e-sign link with these
   checks is sufficient for your use (community features are disclosures of the child's content) is a judgement for
   you or counsel. Alternatives: card verification, a video call, a government ID check.
3. **Adults still in high school.** Both documents define a Minor to include anyone still in high school, and Privacy
   §2 says such students need a parent to co-sign. With the flag on, the code treats everyone 18 or over as an adult
   and registers them at once (decision 24: "18+ register at once"). Either keep that and drop "still enrolled in high
   school" from the self-registration rule, or ask for a co-signature from high-school adults too.
4. **What a pending 13–17 account may do.** The live Privacy text says a pending student cannot use courses, mentoring
   or event registration. Decision 24 allows public content and own registrations. The draft follows decision 24; say
   if courses or mentoring should also wait.
5. **Moderated spaces for under-13s.** No pre-moderation exists, so consented under-13s cannot post at all. Building a
   pre-moderated space type is a separate piece of work if you want them to post.
6. **Australia.** Plan S1 also asks for a written Social Media Minimum Age (16+) self-assessment, with AU under-16
   accounts on the restricted set until it is done. Not built in this change.
