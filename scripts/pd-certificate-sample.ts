/**
 * Renders the sample PD certificate shown on /educators, front and back, from
 * the real renderer and the uploaded Cowork artwork — so the picture on the
 * page is what a teacher actually receives, with a made-up name and SAMPLE
 * across it.
 *
 *   npx tsx scripts/pd-certificate-sample.ts                       # .env.local
 *   npx tsx scripts/pd-certificate-sample.ts --env-file .env.prod.local
 *
 * Writes public/images/educators/pd-certificate-sample-{front,back}.webp.
 * Needs `pdftoppm` (poppler) on the PATH. Re-run after new artwork is uploaded.
 */
import * as dotenv from 'dotenv'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

const envAt = process.argv.indexOf('--env-file')
dotenv.config({ path: envAt > -1 ? process.argv[envAt + 1] : '.env.local' })

const OUT_DIR = path.join(process.cwd(), 'public/images/educators')
const WIDTH = 1200

async function main() {
  // After dotenv: these read env when called, but keep the order safe anyway.
  const { supabaseServer } = await import('@/lib/supabase')
  const { renderPdCertificatePdf } = await import('@/lib/pd-certificate')
  const { loadPdArtwork, loadPdLayout } = await import('@/lib/pd-certificate-store')
  const { pdStandardCodes } = await import('@/lib/pd-standards')
  const sharp = (await import('sharp')).default

  const db = supabaseServer()
  const [artwork, layout] = await Promise.all([loadPdArtwork(db, 'space'), loadPdLayout(db, 'space')])
  if (!artwork.front || !artwork.back) throw new Error('Upload the Space front and back artwork first.')

  const pdf = await renderPdCertificatePdf(
    {
      recipientName: 'Sample Educator',
      hours: 8,
      eventTitle: 'Space Design Challenge',
      activityDate: '2026-11-07',
      activityLocation: 'Las Vegas, Nevada',
      standards: pdStandardCodes(),
      number: 'STL-SAMPLE',
      verifyUrl: 'stellreducation.org/credentials/STL-SAMPLE',
      issuer: 'Stellr Education',
    },
    artwork,
    { layout },
  )

  const work = mkdtempSync(path.join(tmpdir(), 'pd-sample-'))
  try {
    const pdfPath = path.join(work, 'sample.pdf')
    writeFileSync(pdfPath, pdf)
    execFileSync('pdftoppm', ['-png', '-r', '150', pdfPath, path.join(work, 'page')])

    for (const [page, file] of [['front', 'page-1.png'], ['back', 'page-2.png']] as const) {
      const png = readFileSync(path.join(work, file))
      const { width = WIDTH, height = WIDTH } = await sharp(png).resize({ width: WIDTH }).toBuffer({ resolveWithObject: true }).then((r) => r.info)
      // A made-up name is not enough on its own: SAMPLE across the page keeps a
      // saved copy from passing as a real certificate.
      const stamp = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
          <text x="50%" y="54%" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
            font-size="${Math.round(width / 6)}" font-weight="700" fill="#13183A" fill-opacity="0.14"
            transform="rotate(-18 ${width / 2} ${height / 2})">SAMPLE</text>
        </svg>`,
      )
      const out = path.join(OUT_DIR, `pd-certificate-sample-${page}.webp`)
      await sharp(png).resize({ width: WIDTH }).composite([{ input: stamp }]).webp({ quality: 80 }).toFile(out)
      console.log(`wrote ${path.relative(process.cwd(), out)} (${width}×${height})`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
