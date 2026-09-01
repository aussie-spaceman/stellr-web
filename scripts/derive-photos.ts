/**
 * Derive the site's responsive photo set from a full-resolution original.
 *
 * Every photo under /public/media exists as AVIF + JPEG at 480/768/1200/1920
 * (see PHOTO_WIDTHS in lib/media-manifest.ts). That set used to be produced by
 * hand, which is why one hero ended up as a 4 MB CSS background that bypassed
 * the pipeline entirely. This script is the repeatable version.
 *
 * Widths larger than the source are skipped rather than upscaled — record the
 * narrower list on the manifest entry's `widths` when that happens.
 *
 *   npx tsx scripts/derive-photos.ts <source-file> <output-id> [more pairs...]
 *
 * e.g. npx tsx scripts/derive-photos.ts ~/Photos/DSC_5282.JPG home-hero-floor
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const WIDTHS = [480, 768, 1200, 1920]
const OUT_DIR = join(process.cwd(), 'public', 'media')

// Tuned to match the derivatives already in the repo (~125 KB for a 1200px
// JPEG, ~63 KB for its AVIF) so a new photo doesn't stand out in page weight.
const JPEG_QUALITY = 82
const AVIF_QUALITY = 50

export async function derive(source: string, id: string): Promise<number[]> {
  if (!existsSync(source)) throw new Error(`source not found: ${source}`)

  const base = sharp(source, { limitInputPixels: false }).rotate()
  const { width: srcW } = await base.metadata()
  if (!srcW) throw new Error(`cannot read dimensions: ${source}`)

  const widths = WIDTHS.filter((w) => w <= srcW)
  if (widths.length === 0) throw new Error(`source narrower than ${WIDTHS[0]}px: ${source}`)
  if (widths.length < WIDTHS.length) {
    console.warn(`  ! ${id}: source is ${srcW}px — emitting ${widths.join('/')} only.`)
    console.warn(`    Set widths: [${widths.join(', ')}] on its manifest entry.`)
  }

  for (const w of widths) {
    const resized = sharp(source, { limitInputPixels: false }).rotate().resize({ width: w, withoutEnlargement: true })
    const jpg = join(OUT_DIR, `${id}-${w}.jpg`)
    const avif = join(OUT_DIR, `${id}-${w}.avif`)
    await resized.clone().jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(jpg)
    await resized.clone().avif({ quality: AVIF_QUALITY }).toFile(avif)
    const kb = (p: string) => `${Math.round(statSync(p).size / 1024)}KB`
    console.log(`  ${id}-${w}  jpg ${kb(jpg).padStart(6)}   avif ${kb(avif).padStart(6)}`)
  }
  return widths
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2 || args.length % 2 !== 0) {
    console.error('usage: derive-photos.ts <source> <id> [<source> <id> ...]')
    process.exit(1)
  }
  for (let i = 0; i < args.length; i += 2) {
    console.log(`\n${args[i + 1]}  <-  ${args[i]}`)
    await derive(args[i], args[i + 1])
  }
}

if (process.argv[1]?.endsWith('derive-photos.ts')) main()
