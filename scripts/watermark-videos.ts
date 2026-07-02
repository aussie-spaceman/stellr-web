/**
 * Burn "© Stellr Education" into the bottom-right of every self-hosted video
 * (/public/videos/*.mp4 — the public testimonials).
 *
 * Doubles as the pre-upload pass for any master destined for YouTube/Vimeo: point
 * it at a file with `npx tsx scripts/watermark-videos.ts path/to/master.mp4` and it
 * writes `master.watermarked.mp4` next to it, leaving the original untouched.
 *
 * In-place mode (no args) is idempotent via the sha manifest, and re-encodes via a
 * temp file so a failed ffmpeg run never corrupts the original.
 *
 *   npx tsx scripts/watermark-videos.ts                # backfill /public/videos
 *   npx tsx scripts/watermark-videos.ts master.mp4     # one master, non-destructive
 */
import { renameSync, existsSync } from 'node:fs'
import { join, dirname, basename, extname } from 'node:path'
import { watermarkVideoFile } from '../lib/watermark/video'
import { listTargets, loadManifest, saveManifest, fileSha } from './lib/watermark-fs'

async function oneOff(input: string) {
  if (!existsSync(input)) throw new Error(`No such file: ${input}`)
  const out = join(dirname(input), `${basename(input, extname(input))}.watermarked${extname(input)}`)
  console.log(`Watermarking master → ${out}`)
  await watermarkVideoFile(input, out)
  console.log('Done.')
}

async function backfill() {
  const manifest = loadManifest()
  const targets = listTargets(['video'])
  let stamped = 0
  let skipped = 0

  for (const t of targets) {
    if (manifest[t.rel] && manifest[t.rel] === fileSha(t.abs)) {
      skipped++
      continue
    }
    const tmp = `${t.abs}.wm.tmp.mp4`
    console.log(`  … ${t.rel}`)
    await watermarkVideoFile(t.abs, tmp)
    renameSync(tmp, t.abs)
    manifest[t.rel] = fileSha(t.abs)
    stamped++
    console.log(`  ✓ ${t.rel}`)
  }

  saveManifest(manifest)
  console.log(`\nVideos: ${stamped} stamped, ${skipped} already watermarked (${targets.length} total).`)
}

async function main() {
  const arg = process.argv[2]
  if (arg) await oneOff(arg)
  else await backfill()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
