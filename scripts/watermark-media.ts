/**
 * Retroactively bake "© Stellr Education" into the bottom-right corner of every
 * self-hosted photo (/public/media, /public/student-work, /public/team) and every
 * video poster / PDF cover thumbnail — in the pixels, across all widths + formats
 * (avif/webp/jpeg/png).
 *
 * Idempotent via the sha manifest: a file whose current bytes match its manifest
 * entry is skipped, so re-runs only touch new/changed assets. Progress is saved
 * incrementally so a mid-run failure never loses work. To re-stamp after a style
 * change, restore the originals (git checkout public/) and delete their manifest
 * entries first.
 *
 * Some AVIFs the bundled libheif can't re-read ("bad seek") fall back to an ffmpeg
 * decode → re-encode, so every asset gets marked.
 *
 *   npx tsx scripts/watermark-media.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { watermarkImageBuffer, type WatermarkFormat } from '../lib/watermark/image'
import { fileSha, listTargets, loadManifest, saveManifest, sha256 } from './lib/watermark-fs'

const RASTER_FALLBACK = new Set(['.avif', '.webp', '.heic', '.heif'])

function extFormat(ext: string): WatermarkFormat {
  switch (ext.toLowerCase()) {
    case '.avif': return 'avif'
    case '.webp': return 'webp'
    case '.png': return 'png'
    default: return 'jpeg'
  }
}

// Decode an image sharp/libheif can't read (via ffmpeg's dav1d) into a PNG buffer.
function ffmpegDecodeToPng(absPath: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'stellr-wm-'))
  const out = join(dir, 'decoded.png')
  try {
    const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', absPath, out], { encoding: 'utf8' })
    if (res.status !== 0) throw new Error(`ffmpeg decode failed: ${res.stderr?.slice(-400)}`)
    return readFileSync(out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function watermarkOne(absPath: string, current: Buffer): Promise<Buffer> {
  try {
    return await watermarkImageBuffer(current)
  } catch (err) {
    const ext = extname(absPath).toLowerCase()
    if (!RASTER_FALLBACK.has(ext)) throw err
    const png = ffmpegDecodeToPng(absPath)
    return watermarkImageBuffer(png, { outputFormat: extFormat(ext) })
  }
}

async function main() {
  const manifest = loadManifest()
  const targets = listTargets(['image'])
  let stamped = 0
  let skipped = 0
  let untouched = 0
  const failures: string[] = []

  for (const t of targets) {
    const current = readFileSync(t.abs)
    if (manifest[t.rel] && manifest[t.rel] === sha256(current)) {
      skipped++
      continue
    }
    try {
      const out = await watermarkOne(t.abs, current)
      if (out === current || out.equals(current)) {
        // Too small to mark legibly — record its sha so the guard treats it as handled.
        manifest[t.rel] = sha256(current)
        untouched++
      } else {
        writeFileSync(t.abs, out)
        manifest[t.rel] = fileSha(t.abs)
        stamped++
        if (stamped % 25 === 0) {
          console.log(`  … ${stamped} stamped`)
          saveManifest(manifest) // checkpoint progress
        }
      }
    } catch (err) {
      failures.push(`${t.rel} — ${(err as Error).message.slice(0, 120)}`)
      console.error(`  ✗ ${t.rel}`)
    }
  }

  saveManifest(manifest)
  console.log(`\nImages: ${stamped} stamped, ${skipped} already watermarked, ${untouched} too small (${targets.length} total).`)
  if (failures.length) {
    console.error(`\n${failures.length} FAILED:`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
