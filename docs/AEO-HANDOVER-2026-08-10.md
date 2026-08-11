# AEO Handover — 10 Aug 2026

**Status:** Shipped and live in production (commit `c50cbce`, Vercel `dpl_7DVFdqhSFvk3UcLN9vSdTHa6mokj`).
**Scope:** Answer-engine optimisation (ChatGPT, Claude, Perplexity, Google AI Overviews) for the public www site.
**Supersedes in part:** [`REC-seo-aeo.md`](REC-seo-aeo.md) (3 Jul 2026) — see "Prior audit" below.

---

## 1. What shipped, and is verified live

All of the following were confirmed by curling `https://www.stellreducation.org` **after** deploy — not inferred from a green build.

### Crawl surface
| Change | File | Verified |
|---|---|---|
| Sitemap: 10 → 27 static routes (38 URLs total) | `app/sitemap.ts` | `sitemap.xml` returns 38 `<loc>`; all 15 previously-missing pages present |
| Regression test so the list can't rot again | `app/sitemap.test.ts` (new) | 4 tests, green |
| `rel=canonical` on 29 previously-missing pages | 26 static pages + `news/[slug]`, `store/[slug]` | spot-checked `/impact`, `/curriculum`, `/students`, `/membership` |
| `llms.txt` — curated map of the 12 most citable pages | `app/llms.txt/route.ts` (new) | 200, correct body |
| Named AI-crawler rules; `/account`, `/admin`, `/community`, `/home` disallowed per-agent | `app/robots.ts` | `robots.txt` shows both rule blocks |
| Registration funnel + check-in set `noindex` | `app/(public)/register/layout.tsx` (new), `check-in/[slug]` | `<meta name="robots" content="noindex, follow">` |

### Structured data (`lib/structured-data.ts`)
| Node | Where | Verified |
|---|---|---|
| `EducationalOrganization` + `NGO`, `@id`, founded `2021-05`, `Nonprofit501c3`, `areaServed`, `audience`, 10 × `knowsAbout`, 5 × `sameAs` | `app/layout.tsx` (every page) | live on homepage |
| `WebSite` node; Event/Article reference the org by `@id` | `app/layout.tsx` | live |
| `FAQPage` | `/events/[slug]`, `/membership` | both live |
| `NewsArticle` | `/news/[slug]` | **NOT verified — see §3** |
| `Dataset` + `PropertyValue` for 2026 participation figures | `/impact` | live |

### Content
- **`/membership` FAQ answers were invisible to crawlers.** `MembershipExplorer.tsx` rendered them as `{open && …}`, so 4 of 5 answers never reached the HTML. Now always rendered, collapsed with the `hidden` attribute. All 5 confirmed in served HTML.
- **`/impact` claims replaced.** `100k students we aim to impact` and `Top 1% of STEM achievers` (aspirational, unsourced — answer engines discard these) → the 2026 figures below, with a stated collection method and `Dataset` markup.
- **Sanity `author` field** added to `newsPost` so articles can carry named authorship.

### Owner-supplied facts now baked into production markup
Founded **May 2021** · **501(c)(3)** · `sameAs`: LinkedIn, X, Instagram, Facebook, YouTube (`@StellrEducation`).

2026 participation (participant-reported at registration): **46%** female · **57%** identifying as a race other than white · **85–90%** progress to college STEM or medicine · **33%** repeat participants · average age **16**.

---

## 2. Gaps against the prior audit — items still open

`docs/REC-seo-aeo.md` (3 Jul 2026) audited the same surface. **It was not read before this session's review**, which is why the overlap went unnoticed and why the items below were missed. Future sessions: grep `docs/REC-*.md` first.

Most of that audit's P1/P2 items were independently covered here (sitemap, canonicals, register `noindex`, `FAQPage`, `NewsArticle`). These were **not**:

| Prior audit item | Status | Why it matters |
|---|---|---|
| **P1 — No default Open Graph image** | **Still open.** No `app/opengraph-image.png`; root `openGraph` has no `images`. Confirmed: the homepage emits **no `og:image` at all**. | Every page except news/events shares with no preview card. Cheapest remaining win — one 1200×630 file at `app/opengraph-image.png` and Next wires it site-wide. |
| **P2 — `Course` schema on `/academy`** | Not implemented. | `/academy` is a pillar page; `Course` is well-supported and directly answer-engine relevant. |
| **P2 — `Product` schema on `store/[slug]`** | Not implemented. | Store products are invisible as commerce entities. |
| **P3 — sitemap `lastModified: new Date()`** | **Regression carried forward.** The rewritten `app/sitemap.ts` still stamps every static route with the current time on every request. | Tells crawlers the whole site changes daily, which devalues the signal. Use real dates or omit for static routes. |
| **P3 — host-aware robots** | Partially addressed. One `robots.ts` still serves both hosts, but member/admin paths are now disallowed for every agent, which covers the substantive risk. | Low priority. |

Also identified during this session but never surfaced at the time: **`LearningResource` / `Course` schema on `/curriculum/atmospheric-requirements` and its teacher companion.** That tutorial is the single richest piece of educational content on the site (worked examples, NGSS alignment, answer key) and currently carries no schema.

---

## 3. Shipped but unverified — do not assume these work

1. **`NewsArticle` JSON-LD has never executed.** There are zero `newsPost` documents in Sanity, so the sitemap contains no `/news/*` URLs and the code path has never run against real data. It typechecks and mirrors the verified Event builder, but treat it as untested until a post is published.
2. **The Sanity `author` field is live but unused.** No posts exist to backfill. The Studio is embedded at `/studio`, so the field deployed with the app — no separate Studio deploy needed.
3. **`author` is selected in only 1 of 3 news GROQ queries** (`getNewsPostBySlug`). `getAllNewsPosts` and `getRelatedNewsPosts` don't fetch it. Harmless today — only the detail page emits `NewsArticle` — but a byline on index/related cards would come back empty.
4. **`sameAs` URLs were never confirmed to resolve.** The Facebook and YouTube URLs were taken on trust and asserted into production markup. A wrong `sameAs` actively weakens entity resolution rather than being merely inert. **Click all five.**
5. **No Rich Results Test / schema.org validator run.** All JSON-LD was parsed with `json.tool`, which proves it is well-formed JSON — not that it is valid schema.org.
6. **FAQ answer text has a minor divergence.** In `events/[slug]`, the schema `text` fields append full URLs (`…scholarship page at https://…`) where the visible copy shows link text only. Defensible as a plain-text rendering, but the rule this session set — schema text must match visible copy — is bent here.

---

## 4. Measurement — baseline was lost

The plan called for capturing a baseline **before** deploying. The deploy was requested and executed first, so the before/after comparison is unrecoverable. Start the baseline from now and treat it as post-change.

Two things actually measure AEO; Search Console does not:
1. **Crawler logs.** Filter Vercel logs for `GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot` user agents; track volume and which paths they fetch.
2. **Prompt panel.** Fix ~15 target queries ("STEM design competitions for high school students", "free NGSS-aligned aerospace curriculum", "how do student engineering competitions work"), run across ChatGPT / Claude / Perplexity / AI Overviews monthly, and record both *whether* Stellr appears and *how it is described* — the description column is what tells you the Organization entity work is landing.

---

## 5. Gotchas for future sessions

- **`llms.txt` must be a route handler**, never `public/llms.txt`. Anything new under `public/` fails the `check:watermarks` prebuild guard and the Vercel build with it.
- **Push to `main` auto-deploys production** via Vercel's GitHub integration (~4 min). No `npx vercel` needed. Prefer the git path over `vercel --prod` from the working tree — it is the only route where an uncommitted local file cannot reach prod.
- **Accordions must not unmount their content.** Collapse with `hidden` or CSS. `{open && …}` makes content invisible to crawlers, which is exactly how the membership FAQ bug arose.
- **`app/sitemap.test.ts` will fail on any new public page** until it is added to `staticPaths` or `STATIC_ROUTE_EXCLUSIONS` in `app/sitemap.ts`. That is deliberate.
- **Vitest's jsdom env breaks `fileURLToPath(import.meta.url)`** ("URL must be of scheme file") — use `process.cwd()` in tests that touch the filesystem.
- **Read `docs/REC-*.md` before starting any audit.** This session re-derived a July audit from scratch and still missed three of its items.

---

## 6. Recommended order of work

1. **Default OG image** (`app/opengraph-image.png`, 1200×630). XS effort, P1, affects every share and several answer-engine preview surfaces.
2. **Verify the five `sameAs` URLs** resolve. Two minutes; wrong values are worse than absent ones.
3. **Fix sitemap `lastModified`** — real dates or omit for static routes.
4. **Rich Results Test** on `/`, an event page, `/membership`, `/impact` once a news post exists.
5. **Publish one news post**, then verify `NewsArticle` output and backfill `author`.
6. **`Course` on `/academy`, `LearningResource` on the atmospheric-requirements tutorial, `Product` on `store/[slug]`.**
7. **Start the measurement baseline** (crawler logs + prompt panel).
