# PROMPTS — per-PR prompts for Claude Code

Paste these into Claude Code **one at a time**, in order. Each is scoped to a single reviewable PR from `02_BUILD_PLAN.md`. After each, review the diff, run `npm run build && npx tsc --noEmit && npm run lint`, eyeball against `Stellr Design Review.dc.html`, then merge before moving on.

> First message of the session (once):
> *"Read `CLAUDE.md`, then `design_handoff_app_redesign/README.md`, `01_DESIGN_TOKENS.md`, `02_BUILD_PLAN.md`, `03_DATA_CONTRACTS.md`, and `04_AGENT_NOTES.md`. Don't write code yet — summarize the plan and the design rules back to me, and list the files you'd touch for Stage 1."*

---

## Stage 1 — Foundations

### PR 1.1 · Tokens
```
Implement task T1.1. Apply diffs A, B, and C from 01_DESIGN_TOKENS.md to tailwind.config.ts and styles/globals.css, and create lib/ui/sections.ts. Don't change any screens yet. Confirm npm run build passes and the new utilities (bg-brand-canvas, shadow-card, font-display, app-card) resolve. Show me the diff.
```

### PR 1.2 · Monochrome → brand sweep
> Note: this sweep is large in the current repo (~81 files / ~2,380 occurrences). Do it in two passes so each diff is reviewable — paste PR 1.2a first, then PR 1.2b.

PR 1.2a (components):
```
Implement task T1.2 for components/** ONLY (skip components/admin/**). Apply the find/replace map (diff D in 01_DESIGN_TOKENS.md) — colors/borders/text tokens only, preserve every layout exactly. Recolor components/community/ChatPanel.tsx bubbles and send button per the spec. Then run the grep self-checks in 04_AGENT_NOTES.md scoped to components/ and paste the results.
```
PR 1.2b (member app):
```
Implement task T1.2 for app/(member)/** ONLY — do not touch app/(admin)/**. Apply the same find/replace map (diff D), layout unchanged. Run the grep self-checks scoped to app/(member)/ and paste the results to prove no gray-*/indigo-*/amber-* remain in member UI.
```

### PR 1.3 · Typography
```
Implement task T1.3. Give headings real hierarchy: section/screen titles use font-heading uppercase (text-title/text-display), labels/chips/buttons use font-subheading, the welcome name and big numbers use font-display, body stays font-sans. Don't restructure layouts. Verify Archivo Black and Fredoka actually render in-app (they currently never do).
```

### PR 1.4 · Avatars
```
Implement task T1.4. Add components/ui/Avatar.tsx and AvatarStack (use reference_components/Avatar.tsx as the basis; wire src to the member photo if one exists, else colored initials). Use them in: the member directory, post author lines, comments, ChatPanel, and any home feed. No member name should render without an avatar. Keep data logic unchanged.
```

---

## Stage 2 — Structure

### PR 2.1 · Sidebar nav
```
Implement task T2.1. Add components/layout/AppSidebar.tsx (base it on reference_components/AppSidebar.tsx) and wire it into app/(member)/layout.tsx, replacing the AppHeader hover-dropdown nav on member routes. Keep AppSearch, NotificationBell, and the Clerk NavUserButton — relocate them into the rail footer or a slim top strip. Desktop ≥lg = 228px navy rail; <lg = bottom tab bar with ≥44px targets. Active route highlighted in its section color. Don't delete AppHeader (other shells may use it); just stop rendering its nav on (member). IMPORTANT: the sidebar must reach EVERY destination the old dropdowns did — Spaces, Resources, Directory (Community) and Training, Mentoring, Coaching, and conditional Hosting (Academy) — not just the 5 in the original mock. Compute the canHost flag server-side using the same logic as AppHeader's showHosting and pass it to AppSidebar. Verify nothing else regresses.
```

### PR 2.2 · Home route
```
Implement task T2.2. Create app/(member)/home/page.tsx as an RSC, using reference_components/HomeDashboard.tsx for layout/styling and the helpers in 03_DATA_CONTRACTS.md for real data (getCurrentMember, getMemberEvents, getAssignedModules, listModules, the sessions query, getHomeFeed). Make /home the post-auth landing — update the redirect currently pointing to /community. The redirect is in proxy.ts at the repo root (~line 36) — the project renamed middleware.ts → proxy.ts, so there is no middleware.ts; also check the onboarding-complete redirect. Build the loading.tsx skeleton and the empty states with the exact copy in 02_BUILD_PLAN.md. No placeholder/sample copy may ship. Seed locally first (seed/) so you can verify against real data.
```

### PR 2.3 · Card system
```
Implement task T2.3. Extract components/ui/Card.tsx aligned to the .app-card class and refit the Spaces, Training, Events, and Directory lists to it (consistent radius 16, warm border, soft shadow, section accent). Pure presentational refactor — no data or routing changes.
```

---

## Stage 3 — Screen refits (each is its own PR; can run in parallel after Stage 2)

### PR 3.1 · Spaces
```
Implement task T3.1 on app/(member)/community/page.tsx per the README "Community spaces" before/after and 03_DATA_CONTRACTS.md: eyebrow + Norwester title, unread count in subtitle, space cards with blue left-accent + orange "N new" pill + member AvatarStack, locked cards with the gold "Unlock with membership" treatment. Keep all gating logic.
```

### PR 3.2 · Academy / Training
```
Implement task T3.2 on app/(member)/community/training/page.tsx: replace the gray module covers with section-colored gradients (Curriculum blue, CTE orange, Library navy), swap in the gold ProgressRing (reference_components/ProgressRing.tsx), keep mandatory/due badges in orange. Don't change the module/section/progress data flow.
```

### PR 3.3 · Directory
```
Implement task T3.3 on app/(member)/community/members/page.tsx: avatar-led member cards, school + region chips gated by show_school/show_region, role badge in section color, filter bar restyled with .input-field. Keep the opt-in query and filters intact.
```

### PR 3.4 · Account
```
Implement task T3.4 on app/(member)/account/page.tsx: tab active state to brand-blue (remove indigo), section cards to .app-card, membership card in navy/gold. Tabs/data logic unchanged.
```

### PR 3.5 · Event hub
```
Implement task T3.5 on app/(member)/community/events/[slug]/page.tsx: orange-accented header mirroring the Home hero (imagery optional, e.g. /images/hero-stem.JPG treatment), prep checklist, materials list. Reuse getEventMaterials and existing access checks.
```

---

## Stage 4 — Delight (optional, only when asked)
```
Let's do Stage 4 item <X> from 02_BUILD_PLAN.md. Propose an approach first; keep it additive and behind the existing data — no schema changes without flagging them.
```

## If something's ambiguous
Tell Claude Code: *"If a spec is unclear or you'd deviate from an existing pattern, stop and ask rather than guessing."* It's in CLAUDE.md, but repeating it per session helps.
