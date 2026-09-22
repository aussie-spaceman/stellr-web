/**
 * Sync the public marketing media (testimonial videos, photos, gated PDFs) to
 * the `stellr-media` public Vercel Blob store.
 *
 * Why: those files used to live in /public and shipped with every deployment —
 * 515 MB of static output per build, which is what filled the Hobby team's
 * 10 GB Deployment Storage (see HANDOVER-vercel-deployment-storage-2026-09-21).
 * The app reads them through `mediaUrl()` in lib/media-manifest.ts, which
 * prefixes NEXT_PUBLIC_MEDIA_BASE_URL, so the Blob store must mirror the old
 * /public paths exactly: `videos/<id>.mp4`, `media/<id>-1200.avif`, `files/x.pdf`.
 *
 * Idempotent by pathname + size: a blob that already exists with the same byte
 * length is skipped, so re-running after adding one file uploads one file.
 * Uploads use `addRandomSuffix: false` so the pathname is the URL.
 *
 * Prerequisites:
 *   BLOB_READ_WRITE_TOKEN in .env.local (the CLI writes it when the store is
 *   connected: `vercel blob create-store stellr-media --access public`).
 *
 * Run:
 *   npx tsx scripts/upload-media.ts --src=/path/to/media           # dry run
 *   npx tsx scripts/upload-media.ts --src=/path/to/media --apply   # upload
 *   npx tsx scripts/upload-media.ts --src=… --apply --only=videos  # one subdir
 *
 * `--src` is a directory whose children are `videos/`, `media/`, `files/`
 * (the same layout /public had). It is deliberately outside the repo: the
 * bytes are not versioned here any more.
 */
import * as dotenv from 'dotenv'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { head, list, put } from '@vercel/blob'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const SRC = process.argv.find((a) => a.startsWith('--src='))?.slice('--src='.length)

const SUBDIRS = ['videos', 'media', 'files'] as const

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
}

// Blob caches for a month by default; these filenames never change content
// (a re-cut gets a new id in the manifest), so a year is safe.
const CACHE_MAX_AGE = 60 * 60 * 24 * 365

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (entry.name.startsWith('.')) return []
    return [full]
  })
}

async function main() {
  if (!SRC) {
    console.error('Missing --src=<dir> (a directory containing videos/, media/, files/)')
    process.exit(1)
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is not set — connect the store first')
    process.exit(1)
  }
  const root = path.resolve(SRC)
  const subdirs = SUBDIRS.filter((s) => !ONLY || s === ONLY).filter((s) =>
    fs.existsSync(path.join(root, s)),
  )
  if (subdirs.length === 0) {
    console.error(`None of ${SUBDIRS.join('/')} found under ${root}`)
    process.exit(1)
  }

  // One listing up front is cheaper than a head() per file (both are
  // "advanced" ops on Hobby, but list() pages 1000 at a time).
  const existing = new Map<string, number>()
  for (const s of subdirs) {
    let cursor: string | undefined
    do {
      const page = await list({ prefix: `${s}/`, cursor, limit: 1000 })
      for (const b of page.blobs) existing.set(b.pathname, b.size)
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
  }

  let uploaded = 0
  let skipped = 0
  let bytes = 0
  let baseUrl: string | undefined

  for (const s of subdirs) {
    for (const file of walk(path.join(root, s))) {
      const pathname = path.relative(root, file).split(path.sep).join('/')
      const size = fs.statSync(file).size
      if (existing.get(pathname) === size) {
        skipped++
        continue
      }
      const ext = path.extname(file).toLowerCase()
      const contentType = CONTENT_TYPES[ext]
      if (!contentType) {
        console.warn(`skip (unknown type): ${pathname}`)
        continue
      }
      console.log(`${APPLY ? 'upload' : 'would upload'} ${pathname} (${(size / 1e6).toFixed(1)} MB)`)
      uploaded++
      bytes += size
      if (!APPLY) continue
      const result = await put(pathname, fs.createReadStream(file), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType,
        cacheControlMaxAge: CACHE_MAX_AGE,
        multipart: size > 50 * 1024 * 1024,
      })
      baseUrl ??= result.url.slice(0, result.url.length - pathname.length - 1)
    }
  }

  // Keep crawlers off the raw store; the site pages are the canonical URLs.
  if (APPLY && !ONLY) {
    await put('robots.txt', 'User-agent: *\nDisallow: /\n', {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'text/plain',
    })
  }

  if (!baseUrl) {
    const h = await head('robots.txt').catch(() => null)
    baseUrl = h ? h.url.replace(/\/robots\.txt$/, '') : undefined
  }

  console.log(
    `\n${APPLY ? 'Uploaded' : 'Would upload'} ${uploaded} file(s), ${(bytes / 1e6).toFixed(1)} MB; ${skipped} already current.`,
  )
  if (baseUrl) console.log(`NEXT_PUBLIC_MEDIA_BASE_URL=${baseUrl}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
