# Community flow audit — 8 UX/conversion fixes

Implements F-01…F-08 from the community flow audit (`design_handoff_community_flow_fixes/FIXES.md`). Primary conversion optimised: **join a space → post**.

## Fixes

- **F-01** — Joining a space no longer dead-ends: success toast "You've joined {space}" with a working **Go to space →** action; button flips Join → Joining… → Joined ✓; member stays on the directory (no auto-navigation), card still regroups via `router.refresh()`.
- **F-02** — Locked & restricted spaces now offer an upgrade path: locked screen gets a primary **See membership options →** button; restricted directory cards get an inline **Requires {tier} · Upgrade** link and read less disabled (opacity 0.62 → 0.85). Both land on `/membership#{tierSlug}` anchored at the **lowest qualifying tier** (new `lowestQualifyingTier` / `membershipUpgradeHref` in `tier-data.ts`; `MembershipExplorer` now honours tier-slug hashes by selecting the audience + card and scrolling the explorer into view).
- **F-03** — One composer: the in-feed `ChannelFeed` composer gains rich text (`RichTextEditor`) + an optional title; `NewPostForm` deleted (it had no usages). New `PostHeading` never renders an empty `<h1>` for titleless posts. Posts API already accepted an optional `title` on the channel path — no API change.
- **F-04** — Failed joins are no longer silent: non-OK responses and network errors toast "Couldn't join — please try again." and re-enable the button.
- **F-05** (copy-only) — Home: "Start a discussion →" → **Browse spaces →**, "View all →" → **All spaces →**; `/community` targets unchanged.
- **F-06** — Next-event hero colour-codes by pathway: campaign = amber, competition = primary blue. New `pathwayAmberDeep` token (#C2722A — the gradient end the hero already used); gradients moved to token-var Tailwind classes; inline hex removed; CTA text colour follows the scheme.
- **F-07** — 👋 / 🎉 removed from the dashboard header, caught-up line and `WelcomeBanner`; sanctioned ✦ (star-gold) flourish instead. `ReactionBar` emoji untouched.
- **F-08** — Hosting no-access state: "Contact an administrator" is now a `mailto:hello@stellreducation.org` link (the address already used on the contact page / terms / site metadata). No host-application route exists, so no "Apply to host" CTA — flagging per the spec.

## Tests & tooling

The repo had **no test framework**, so the first commit adds **Vitest + React Testing Library** (`npm test`), per the handover instructions. 10 test files / 32 tests cover every fix's listed scenarios. All green, plus:

- `npx tsc --noEmit` ✓
- `npm run build:tokens` + `npm run lint:tokens` ✓
- Tailwind compile spot-check: the new gradient + `text-pathway-amber-deep` utilities emit real CSS ✓

## Notes for review

- The composer's Post button now requires a title or body before enabling. Previously it enabled with only a file attached, but that path always 400'd server-side ("Post is empty") — pre-existing; the button now just tells the truth.
- Hero tint texts moved `text-orange-100` → `text-white/85` so they read correctly on both gradient schemes.
- `Toast` hex literals were converted to token utilities (`bg-ink`, `text-enviro-green`, `text-star-gold`) — same rendered values.
- From the app subdomain, `/membership` 308-redirects to www (proxy.ts); browsers preserve the `#tierSlug` fragment across redirects, so the anchor deep-link works cross-subdomain.

## Manual QA checklist

**F-01**
- [ ] Clicking Join on a Discover card shows a toast with a working `Go to space →` action that routes to that space.
- [ ] The button reads `Joined ✓` after success and is no longer clickable.
- [ ] The card still regroups into "Your spaces".
- [ ] No auto-navigation on join.

**F-02**
- [ ] The locked space screen shows a primary CTA landing on the membership page with the lowest qualifying tier in view.
- [ ] Restricted cards show a working `Upgrade` link to the same destination and no longer look disabled.
- [ ] The card body still routes to the locked screen; the Upgrade link is independently clickable.
- [ ] Tier names come from `describeAssignedTiers` / tier data — no hard-coded tier strings.

**F-03**
- [ ] Exactly one post composer (in-feed), with rich text + optional title.
- [ ] A post created without a title opens on its detail page with no empty heading.
- [ ] Attachments and realtime updates still work in the feed composer.
- [ ] No `NewPostForm` references remain.

**F-04**
- [ ] A non-OK join response shows an error toast; the button returns to `Join`.
- [ ] A network error shows the same error toast.

**F-05**
- [ ] Both links keep their `/community` targets; labels describe browsing.

**F-06**
- [ ] Competition events render a blue hero; campaign events render amber.
- [ ] No hard-coded hex in the hero block; `lint:tokens` passes.

**F-07**
- [ ] No emoji in the dashboard header, the caught-up line, or the welcome banner; reaction emoji unchanged.

**F-08**
- [ ] The no-access state offers a working way to contact an admin (existing address, none invented).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
