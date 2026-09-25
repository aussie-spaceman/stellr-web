# Runbook — AEO measurement (monthly)

How we know whether answer-engine work is moving anything. Set up 24 Sept 2026
(AEO phase 1). Replaces the HubSpot AEO trial, whose data is no longer
reachable; the pre-August baseline was never captured, so the first run below
**is** the baseline, labelled as post-August-changes.

## Two measures

| Measure | What it tells you | Tool |
|---|---|---|
| **Crawler visits** | Whether search and AI crawlers are fetching the site, and which pages | `crawler_hits` table ← `proxy.ts`; `npm run aeo:crawlers` |
| **Prompt panel** | Whether assistants mention or cite Stellr for fixed teacher questions | `content/aeo/prompt-panel.ts`; `npm run aeo:panel` |

The number to watch is **unprompted mentions on category prompts** — whether
Stellr comes up when a teacher asks about STEM competitions without naming us.
Brand prompts only check that what assistants say about Stellr is accurate.

## Monthly, first week

1. **Crawler report (production).** Run with the production Supabase URL and
   service-role key exported in the shell for this command only — never put
   them in `.env.local` (see `docs/ENV-MATRIX.md`):
   ```bash
   npm run aeo:crawlers -- --days 30
   ```
2. **Prompt panel.** Needs at least one of `ANTHROPIC_API_KEY`,
   `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`, `GEMINI_API_KEY` in `.env.local`.
   ```bash
   npm run aeo:panel
   ```
   Writes `.aeo-panel/<date>.csv` (gitignored). Paste it into the AEO tracker
   sheet as a new tab named for the date.
3. **Read brand answers for errors.** Wrong fees, grades, founding date or
   "for-profit" descriptions are fixed on the site (and in `llms.txt`), not
   argued with.
4. **After a promotion that adds public pages:** `npm run indexnow` (needs
   `INDEXNOW_KEY`, and the same key set on the production project).

## Rules

- **Never reword a panel prompt.** Retire it and add a new id; otherwise its
  history stops being comparable.
- **Never name the excluded space-settlement competition family** in panel
  prompts, tracked programs or published content — standing editorial
  decision (24 Sept 2026).
- API answers approximate the consumer apps; treat single answers as noise and
  month-on-month direction as the signal.
