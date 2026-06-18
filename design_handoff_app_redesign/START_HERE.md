# START HERE — handing this redesign to Claude Code

A step-by-step runbook. Do the steps in order; each "✅ Check" tells you it worked before you move on.

---

## Step 0 — One-time setup (≈15 min)
1. **Install Claude Code** and sign in:
   ```bash
   npm install -g @anthropic-ai/claude-code
   cd /path/to/stellr-web
   claude            # follow the auth prompt
   ```
2. **Confirm the app runs today** (Claude Code needs a working baseline to verify against):
   ```bash
   npm install
   cp .env.local.example .env.local   # fill in Clerk, Supabase, Sanity, Stripe keys
   npm run dev                        # open http://localhost:3000
   ```
   ✅ Check: the site loads and you can sign in.

---

## Step 1 — Put this package in the repo
From the unzipped `design_handoff_app_redesign/` folder:
1. Copy **`CLAUDE.md`** to the **repo root** → `stellr-web/CLAUDE.md`.
2. Copy the **whole folder** into the repo → `stellr-web/design_handoff_app_redesign/`.
3. (Recommended) Copy **`claude-settings.example.json`** to `stellr-web/.claude/settings.json` (create the `.claude/` folder). Edit to taste.
4. Start a branch:
   ```bash
   git checkout -b redesign/app-look-and-feel
   git add . && git commit -m "chore: add redesign handoff package + CLAUDE.md"
   ```
   ✅ Check: `CLAUDE.md` is at the repo root; the handoff folder is committed.

---

## Step 2 — Seed a DEV database (so screens have realistic data)
> Use a **dev/staging** Supabase + Sanity — never production.
1. Apply all migrations to your dev Supabase (`supabase db push` or your usual flow).
2. Run the seed:
   ```bash
   psql "$SUPABASE_DB_URL" -f design_handoff_app_redesign/seed/seed.sql
   ```
3. Import the event into Sanity, then set its date ~2 weeks out (see `seed/README.md`).
4. Point the seeded member at **your** Clerk user:
   ```sql
   UPDATE public.members SET clerk_user_id = '<your_clerk_user_id>'
   WHERE email = 'avanee.seed@example.com';
   ```
   ✅ Check: sign in → you see Avanee's data (spaces, training, sessions).

*(You can skip Step 2 and let Claude Code build against empty/placeholder states, but seeded data makes its visual checks far more reliable.)*

---

## Step 3 — Open the session and orient the agent
In the repo, run `claude`, then paste this **once**:
```
Read CLAUDE.md, then design_handoff_app_redesign/README.md, 01_DESIGN_TOKENS.md,
02_BUILD_PLAN.md, 03_DATA_CONTRACTS.md, and 04_AGENT_NOTES.md. Look at the images in
design_handoff_app_redesign/screenshots/. Don't write code yet — summarize the plan and
the design rules back to me, and list the files you'd touch for Stage 1.
```
✅ Check: it plays back the brand rules (brand tokens, section colors, fonts, avatars) and a sane Stage 1 file list. If it's off, correct it now before any code.

---

## Step 4 — Build, one PR at a time
Open **`PROMPTS.md`** and paste the prompts **in order**, starting with **PR 1.1**. After each prompt:
1. Review the diff.
2. Run: `npm run build && npx tsc --noEmit` (the agent should do this; verify). *(There is no `lint` script in this repo — build + tsc are the gates.)*
3. For the brand sweep (PR 1.2), check the grep output it pastes shows **no** `gray-*/indigo-*/amber-*` left in member UI.
4. Compare against the matching image in `screenshots/`.
5. Commit/merge the PR, then move to the next prompt.

**Suggested first milestone:** ship **Stage 1 (PR 1.1–1.4)** and look at it — that alone transforms the feel (brand color, fonts, avatars) at low risk. Then decide whether to continue to Stage 2 (Home + sidebar).

---

## Guardrails (already in CLAUDE.md / 04_AGENT_NOTES.md — good to know)
- Don't touch `app/(admin)/**`, the database schema/migrations, env files, or data-access logic without explicit approval.
- Two changes need a human's eyes: the **nav swap** in `app/(member)/layout.tsx` (PR 2.1) and the **post-auth redirect** to `/home` (PR 2.2).
- The reference `.tsx` files are guides, not drop-in code — the agent reconciles imports/types with the real repo.

## If you get stuck
Tell Claude Code: *"If a spec is unclear or you'd deviate from an existing pattern, stop and ask instead of guessing."* And keep PRs small — one task id per PR.
