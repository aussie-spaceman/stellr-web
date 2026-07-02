/**
 * Retroactively stamp "© Stellr Education" on the bottom-right of every page of
 * every downloadable PDF in /public/files (whitepaper, RFPs, program books, …).
 *
 * Idempotent: skips any file whose current bytes already match the watermark
 * manifest, and stampPdfBytes itself no-ops on an already-marked PDF. Safe to
 * re-run whenever new PDFs are added.
 *
 *   npx tsx scripts/watermark-pdfs.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { stampPdfBytes } from '../lib/watermark/pdf'
import { listTargets, loadManifest, saveManifest, sha256 } from './lib/watermark-fs'

async function main() {
  const manifest = loadManifest()
  const targets = listTargets(['pdf'])
  let stamped = 0
  let skipped = 0

  for (const t of targets) {
    const current = readFileSync(t.abs)
    if (manifest[t.rel] && manifest[t.rel] === sha256(current)) {
      skipped++
      continue
    }
    const out = Buffer.from(await stampPdfBytes(new Uint8Array(current)))
    writeFileSync(t.abs, out)
    manifest[t.rel] = sha256(out)
    stamped++
    console.log(`  ✓ ${t.rel}`)
  }

  saveManifest(manifest)
  console.log(`\nPDFs: ${stamped} stamped, ${skipped} already watermarked (${targets.length} total).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
