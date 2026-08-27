# Handover — Upload architecture migration (27 Aug 2026)

**Status:** shipped to production. `a60ac43` is live (`dpl_EK2Qe2MicLeyRCHSienY6Ep5MYzW`),
aliased to `app.stellreducation.org` and `www`.

Three commits, in order:

| Commit | What |
|---|---|
| `2733f9f` | Client-side upload robustness (read-before-post, real error messages) |
| `ec21fdb` | Admin resources → direct-to-storage, 25MB |
| `c9f6d68` | **All 11 routes** → direct-to-storage; multipart deleted |
| `a60ac43` | Build fix for `c9f6d68` (see §5) |

---

## 1. The problem

Vercel rejects a request body over **4.5MB before the function runs**. No env var,
`vercel.json` key or plan changes this. Eleven routes accepted file bodies, so every
upload in the app was capped there — and most advertised limits they could never honour:

| Route | Claimed | Actual |
|---|---|---|
| `campaigns/[slug]/submit` | 25MB | 4.5 |
| `community/resources/attach` | 25MB | 4.5 |
| `members/compliance/document` | 10MB | 4.5 |
| `admin/events/[slug]/artwork` | 10MB | 4.5 |
| `community/media/upload` | 8MB | 4.5 |
| `admin/…/training/items` | `maxRequestBodySize = '500mb'` | 4.5 |

That last one accepts **video**. It could never have worked.

### The diagnostic that mattered
The reported failure left **no server-side trace at all** — no Vercel runtime log, no
runtime error, no Supabase storage write. When a request leaves no trace anywhere, it
never left the browser. Don't hunt the server.

⚠️ **A wrong turn worth not repeating:** the same filename existed twice in Drive
(`…/Verified Content/…/2027 - Mission Handbook - Abridged.pdf` = 1.2MB;
`…/1 Narrative + Content/2027/A Core Material/…` = **6.5MB**). Measuring the wrong copy
led to "size isn't the cause" and a day's worth of the wrong hypothesis. Confirm the
file the user actually picked, by size, before reasoning about limits.

## 2. The architecture now

`lib/uploads.ts` is the single source of truth: a registry keyed by **purpose** holding
bucket, size limit, type allowlist and authorisation.

```
browser ──POST /api/uploads/sign──> signUpload()   (metadata only)
        <──{ bucket, path, token }──
        ──PUT bytes────────────────> Supabase Storage   (never touches a function)
        ──POST { storagePath }─────> owning route → claimUpload()
```

**Authorisation is two-layer, deliberately.** `sign` answers "may this caller write into
this namespace at all". The claiming route still re-checks the object-level rule (does
this member manage that container, is that post in that space) before recording anything.
A signed URL alone never makes a file reachable: buckets are private and nothing is served
without a row.

**Verification moved with the bytes.** The signing step only sees what the browser *claims*
about its own file; between signing and claiming it could PUT anything. So size and format
are enforced in `claimUpload()` against the object that actually arrived — including the
teacher-license magic-byte sniff (the check that most needed to survive), plus new sniffs on
post images, event artwork and cert templates. A rejected object is **deleted**, not orphaned.

### Purposes

| Purpose | Bucket | Limit | Gate |
|---|---|---|---|
| `admin-resource`, `space-resource` | community-resources | 25MB | admin |
| `training-item` | community-resources | **200MB — see §4.1** | admin |
| `training-item-resource` | community-resources | 25MB | admin |
| `training-cert-template` | community-resources | 10MB, PDF only | admin |
| `event-artwork` | community-resources | 10MB | admin (event access) |
| `campaign-proposal` | campaign-proposals | 25MB | member w/ registration |
| `community-media` | community-resources | 8MB, images only | member |
| `space-attachment` | community-resources | 25MB | member w/ space upload rights |
| `container-contribution` | community-resources | 25MB | member managing container |
| `compliance-document` | teacher-licenses | 10MB, image/PDF | member w/ license row |

## 3. Deprecated / removed

- Every `formData()` branch in `app/api` — **zero remain** (verify with
  `grep -rln "formData()" app/api`). A file body now gets an explicit 415.
- Both `maxRequestBodySize` declarations (`'500mb'`, `'100mb'`) — they never did anything.
- `MAX_UPLOAD_BYTES` and all per-route `MAX_BYTES` constants.
- `createFileBinary()` in `lib/resource-upload.ts` — only caller was the multipart
  contribute branch.

Two pre-existing bugs fixed in passing: member-contributed PDFs were **never watermarked**
(`createFileBinary` skipped it), and contribute's sha256 dedup now hashes the stored bytes.

---

## 4. OPEN — things believed done that are not

### 4.1 ⚠️ Training video upload is NOT fixed. Highest priority.
Two independent reasons:

1. **The registry advertises 200MB; the `community-resources` bucket hard-caps at 50MB**
   (`storage.buckets.file_size_limit = 52428800`). Storage will reject anything larger at
   PUT time. **This is the exact anti-pattern this whole migration removed, reintroduced in
   one place.**
2. **`claimUpload()` downloads the entire object into the function** — even for video,
   whose bytes are never used (video goes to the `enqueueVideoWatermark` ffmpeg queue).
   A large video will be slow and will likely fail on memory or the 60s `maxDuration`.

Also `readUploadBlob()` reads the whole file into **browser** memory before uploading; a
200MB `ArrayBuffer` in a tab is not viable. Fine at 25MB, not at video scale.

**Fix:** add a metadata-only claim path (check size via storage list/info instead of
`download()`) and use it for video; then either raise the bucket limit to match the
registry, or lower the registry to the truth. Do not leave them disagreeing.

### 4.2 No orphan cleanup — new failure mode
A signed-but-never-claimed upload (user closes the tab mid-flow, or the finalise POST
fails) leaves a file in the bucket forever. Claim-time *rejections* delete; abandonment
does not. There is no cron for this. Splitting upload from record created this; it did not
exist when bytes and record arrived in one request.

### 4.3 Nothing has been exercised by a signed-in user
**Nine flows changed and zero have run authenticated.** All testing is against mocks
(300 tests pass). In rough order of blast radius:
teacher license · campaign proposal · course builder (esp. a real video) · chat
attachment · post image · admin resource · space resource · lesson resource · cert template.
The 6.5MB Mission Handbook that triggered all this **has still not been confirmed uploading.**

### 4.4 Watermarking is unobserved
It now happens *after* storage (download → stamp → re-upload) rather than before. The
guarantee is preserved by design and the code path is tested, but no stamped file has been
downloaded and looked at. Worth one manual check.

### 4.5 `fileLabel` is duplicated in three places
`app/api/admin/community/spaces/[id]/resources/route.ts`,
`app/api/community/resources/attach/route.ts`, and `lib/space-resources.ts`.
Re-duplicated deliberately by `a60ac43` (§5) to unblock the build. Fold back together
once §5 resolves. This is the one piece of "code cleanup" the session did not finish.

## 5. Concurrent-session collision (read before touching these files)

A **second session was committing to `main` in the same working directory** during this work.
It moved `fileLabel` into a new `lib/space-resources.ts` which it had not committed.
`c9f6d68` picked up that import while staging, so:

- The local build passed **only because the untracked file was on disk.**
- Vercel builds from the commit, where it doesn't exist → `Module not found` → **deploy failed.**
- Production was never affected (stayed on `ec21fdb`; a failed build doesn't replace the
  running deployment).
- `a60ac43` restored a local `fileLabel` in both routes, making the upload work independent.

**Lesson:** verifying a build against a working tree that contains foreign uncommitted files
does not verify what you are shipping. Build from the commit, or stash first.

**Still unpushed and undecided:** local commit `f2d13e4` "Show a Space's catalogue-attached
files to its members, not just its uploads" — the other session's feature, plus its
untracked `lib/space-resources.ts`. It is a genuine bug fix (catalogue-attached files show
in the admin console but are invisible to members). **Not mine to ship; David to decide.**

## 6. Files

**New:** `lib/uploads.ts` (registry, sign, claim) · `lib/uploads.test.ts` (13 tests) ·
`app/api/uploads/sign/route.ts`
**Rewritten:** `lib/upload-client.ts` (+ tests), `lib/resource-finalise.ts`
**11 routes + 11 client components** — see `git show c9f6d68 --stat`.

## 7. Quick verification commands

```bash
grep -rln "formData()" app/api                 # must be empty
grep -rn "maxRequestBodySize" app              # must be empty
grep -rn "set('file'\|append('file'" app components   # must be empty
npx vitest run lib/uploads.test.ts lib/upload-client.test.ts
```
