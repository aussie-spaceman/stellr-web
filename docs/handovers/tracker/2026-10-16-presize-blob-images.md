# Pre-sized Blob images (image transformations, Phase 3) — 2026-10-16

Slug: `presize-blob-images`. Handover: `HANDOVER-presize-blob-images-2026-10-16.md`. Doc snapshot: `1h_niJBzbMzseYohDLzsMxFpsobOCnYEhpBoNPjVKyO8`.
PR #439 → `dev` as `fd7bccaf`; not yet promoted (#441 open at close-out). Migration: none.

The 3 student-work slides and all 9 video posters render from WebP copies cut once at upload (`<name>-<width>.webp` on `stellr-media`, 33 files). They use a plain `<img srcSet>`, with no `/_next/image` request, so they spend no Image Optimization transformations.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| presize-blob-images.1 | #439 in production | On `dev` as `fd7bccaf`. Promotion PR #441 (Phases 1–3, the coordinating session's) was OPEN and BLOCKED at close-out. David decided on 16 Oct that this session would not promote | The coordinating session merges #441 | ☐ |
| presize-blob-images.2 | Production check after #441 | Not run. Checked locally (`next start` against the media host) and on dev: 0 `/_next/image` requests for slides or posters on /competitions, /curriculum and /scholarship | On www, read the server HTML and the browser's resource list for those 3 pages: every srcset should point at `-<width>.webp` on the media host, with no `/_next/image` URL for a slide or poster. Never fetch a production `/_next/image` URL: each uncached fetch costs a transformation | ☐ |
| presize-blob-images.3 | The meter stops counting Blob images | Not measurable from here. Hobby has no usage API | A day after #441, check Vercel → Observability → Image Optimization: no `stellr-media` source should appear among new transformations | ☐ |
| presize-blob-images.4 | Header logo still goes through the optimizer | `/images/logo-horiz.png` is the only `/_next/image` request on the three pages, on every page load. It is one cached source | The coordinating session decides: `unoptimized` on the logo, or leave it | ☐ |
| presize-blob-images.5 | Phones load the 1080 copy | At 375 px with DPR 2, a 341 px frame picks `-1080.webp` (~63–76 KB per slide), because the next step down is 640 | Parked: it needs an extra ~750 px width, which saves ~30–40 KB per slide. Only if mobile weight comes up again | ☐ |
| presize-blob-images.6 | This session's worktree | `.claude/worktrees/nervous-hellman-edabb9` is on `docs/close-out-presize-blob-images`. The local `fix/presize-slides-posters` was deleted (its tip equalled #439's `headRefOid`) | Archive this session in the Claude app once this close-out PR has merged | ☐ |
