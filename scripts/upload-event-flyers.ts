/**
 * Upload the season's event/campaign flyers into Sanity and attach them to the
 * matching event document's `flyers[]` field.
 *
 * The bytes live on Sanity's asset CDN, not in /public — see the schema comment
 * on `flyers` for why. Sanity dedupes uploads by content hash, so re-running
 * with unchanged files creates no new assets.
 *
 * Idempotent by LABEL: an existing flyer entry with the same label on the same
 * document is replaced, anything else authored in the Studio is left alone. So
 * re-running after a flyer is re-issued swaps that one file and nothing else.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_SANITY_PROJECT_ID and a write-scoped SANITY_API_TOKEN in .env.local
 *
 * Run:
 *   npx tsx scripts/upload-event-flyers.ts             # dry run — reports, writes nothing
 *   npx tsx scripts/upload-event-flyers.ts --apply     # upload + patch
 *   npx tsx scripts/upload-event-flyers.ts --apply --only=nevada-space-design-challenge
 *   npx tsx scripts/upload-event-flyers.ts --dir="/path/to/flyers"   # extra source dir
 */
import * as dotenv from 'dotenv'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createClient } from '@sanity/client'
import { PDFDocument } from 'pdf-lib'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const token = process.env.SANITY_API_TOKEN

const APPLY = process.argv.includes('--apply')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const EXTRA_DIRS = process.argv
  .filter((a) => a.startsWith('--dir='))
  .map((a) => a.slice('--dir='.length))

/**
 * Where the artwork lives. The Shared Drive is the source of truth for flyers;
 * these are the two folders the 2027 set was produced into. Pass --dir= to add
 * another without editing this file.
 */
const DRIVE_ROOT =
  process.env.STELLR_DRIVE_ROOT ??
  path.join(
    process.env.HOME ?? '',
    'Library/CloudStorage/GoogleDrive-david.shaw@stellreducation.org/Shared drives/Stellr',
  )
const SOURCE_DIRS = [
  path.join(DRIVE_ROOT, '1 Competitions/2027 Flyers'),
  path.join(DRIVE_ROOT, '1 Campaigns/Flyers'),
  ...EXTRA_DIRS,
]

/**
 * filename → { slug, label }. Filenames are matched case-insensitively against
 * the source dirs above. A slug that isn't in Sanity, or a file that isn't on
 * disk, is reported and skipped — never guessed at.
 */
const FLYERS: { file: string; slug: string; label: string }[] = [
  // ── Live events ─────────────────────────────────────────────────────────
  { file: '2027 - EDC - CO - Flyer 3pp.pdf', slug: 'colorado-environmental-design-challenge', label: 'Event Flyer' },
  { file: '2027 - EDC - MN - Flyer 3pp.pdf', slug: 'minnesota-environmental-design-challenge', label: 'Event Flyer' },
  { file: '2027 - SDC - CO - Flyer 3pp.pdf', slug: 'colorado-space-design-challenge', label: 'Event Flyer' },
  { file: '2027 - SDC - NE - Flyer 3pp.pdf', slug: 'nebraska-space-design-challenge', label: 'Event Flyer' },
  { file: '2027 - SDC - NV - Flyer 3pp.pdf', slug: 'nevada-space-design-challenge', label: 'Event Flyer' },
  { file: '2027 - SDC - SD - Flyer 3pp.pdf', slug: 'south-dakota-space-design-challenge', label: 'Event Flyer' },
  // ── Campaigns ───────────────────────────────────────────────────────────
  { file: '2027 - Space Design Challenge - Flyer 4pp.pdf', slug: 'space-design-campaign-fall', label: 'Campaign Flyer' },
  // No flyer yet: texas-space-design-competition, north-carolina-space-design-challenge,
  // rhode-island-space-design-challenge, uruguay-environmental-design-challenge,
  // environmental-design-campaign-fall. Add a row here when the artwork lands.
]

interface FlyerEntry {
  _key?: string
  _type?: string
  label?: string
  pages?: number
  file?: { _type: 'file'; asset: { _type: 'reference'; _ref: string } }
}

function resolveFile(name: string): string | null {
  for (const dir of SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue
    const direct = path.join(dir, name)
    if (fs.existsSync(direct)) return direct
    // Case-insensitive fallback — Drive filenames get re-cased by hand.
    const hit = fs.readdirSync(dir).find((f) => f.toLowerCase() === name.toLowerCase())
    if (hit) return path.join(dir, hit)
  }
  return null
}

async function pageCount(bytes: Buffer): Promise<number | undefined> {
  try {
    const doc = await PDFDocument.load(new Uint8Array(bytes), { updateMetadata: false })
    return doc.getPageCount()
  } catch {
    return undefined // a page count we can't read just isn't displayed
  }
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function main() {
  if (!projectId) throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID is not set in .env.local')
  if (!token) throw new Error('SANITY_API_TOKEN is not set in .env.local (needs write permission)')

  const client = createClient({
    projectId,
    dataset,
    apiVersion: '2024-01-01',
    useCdn: false,
    token,
    perspective: 'published',
  })

  const rows = ONLY ? FLYERS.filter((f) => f.slug === ONLY) : FLYERS
  if (rows.length === 0) {
    console.error(`No flyer mapped to --only=${ONLY}`)
    process.exit(1)
  }

  const slugs = [...new Set(rows.map((r) => r.slug))]
  const docs: { _id: string; title: string; slug: string; flyers?: FlyerEntry[] }[] =
    await client.fetch(
      `*[_type == "event" && slug.current in $slugs]{ _id, title, "slug": slug.current, flyers }`,
      { slugs },
    )
  const bySlug = new Map(docs.map((d) => [d.slug, d]))

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${dataset} dataset, ${rows.length} flyer(s)\n`)

  let done = 0
  const problems: string[] = []

  for (const row of rows) {
    const doc = bySlug.get(row.slug)
    const abs = resolveFile(row.file)

    if (!doc) {
      problems.push(`${row.file}: no published event with slug "${row.slug}"`)
      continue
    }
    if (!abs) {
      problems.push(`${row.file}: not found under ${SOURCE_DIRS.join(' | ')}`)
      continue
    }

    const bytes = fs.readFileSync(abs)
    const pages = await pageCount(bytes)
    const existing = (doc.flyers ?? []).filter((f) => f.label !== row.label)
    const replacing = (doc.flyers ?? []).length - existing.length

    console.log(
      `  ${doc.title}\n` +
        `    ← ${path.basename(abs)} (${mb(bytes.length)}${pages ? `, ${pages}pp` : ''})\n` +
        `    → ${row.slug} · "${row.label}"${replacing ? ' (replacing existing entry)' : ''}` +
        `${existing.length ? ` · keeping ${existing.length} other flyer(s)` : ''}`,
    )

    if (!APPLY) {
      done++
      continue
    }

    const asset = await client.assets.upload('file', bytes, {
      filename: path.basename(abs),
      contentType: 'application/pdf',
    })

    const entry: FlyerEntry = {
      _type: 'object',
      _key: `flyer-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      label: row.label,
      ...(pages ? { pages } : {}),
      file: { _type: 'file', asset: { _type: 'reference', _ref: asset._id } },
    }

    await client.patch(doc._id).set({ flyers: [...existing, entry] }).commit()
    console.log(`    ✓ uploaded ${asset._id} and patched ${doc._id}`)
    done++
  }

  console.log(`\n${done}/${rows.length} ${APPLY ? 'attached' : 'ready'}.`)
  if (problems.length) {
    console.log('\nSkipped:')
    for (const p of problems) console.log(`  ⚠ ${p}`)
  }
  if (!APPLY) console.log('\nNothing was written. Re-run with --apply to upload.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
