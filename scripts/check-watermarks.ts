/**
 * Prebuild guard: fail the build if any in-scope /public asset (photos, video
 * posters, downloadable PDFs, testimonial MP4s) is missing its watermark.
 *
 * "Watermarked" = the file's current sha256 matches its entry in
 * scripts/watermark-manifest.json (written by the backfill scripts). A new or
 * edited asset won't match, so the build stops until someone runs the relevant
 * watermark script. This is what guarantees future content can't ship unmarked.
 *
 * Set WATERMARK_CHECK=off to bypass (e.g. an emergency deploy).
 *
 *   npx tsx scripts/check-watermarks.ts
 */
import { fileSha, listTargets, loadManifest } from './lib/watermark-fs'

function main() {
  if (process.env.WATERMARK_CHECK === 'off') {
    console.log('watermark check: skipped (WATERMARK_CHECK=off)')
    return
  }

  const manifest = loadManifest()
  const targets = listTargets()
  const missing: { rel: string; kind: string }[] = []

  for (const t of targets) {
    if (manifest[t.rel] !== fileSha(t.abs)) missing.push({ rel: t.rel, kind: t.kind })
  }

  if (missing.length === 0) {
    console.log(`watermark check: OK — all ${targets.length} assets watermarked.`)
    return
  }

  const byKind: Record<string, string[]> = {}
  for (const m of missing) (byKind[m.kind] ??= []).push(m.rel)

  console.error(`\n✖ watermark check FAILED — ${missing.length} asset(s) are not watermarked:\n`)
  for (const [kind, rels] of Object.entries(byKind)) {
    console.error(`  ${kind}:`)
    for (const rel of rels.slice(0, 20)) console.error(`    - ${rel}`)
    if (rels.length > 20) console.error(`    … and ${rels.length - 20} more`)
  }
  const cmds = new Set<string>()
  if (byKind.image) cmds.add('npx tsx scripts/watermark-media.ts')
  if (byKind.pdf) cmds.add('npx tsx scripts/watermark-pdfs.ts')
  if (byKind.video) cmds.add('npx tsx scripts/watermark-videos.ts')
  console.error(`\nRun to fix, then commit the updated files + manifest:`)
  for (const c of cmds) console.error(`  ${c}`)
  console.error('')
  process.exit(1)
}

main()
