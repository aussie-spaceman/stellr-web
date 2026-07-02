import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, relative, extname, posix, sep } from 'node:path'

// Shared definition of "which /public assets must be watermarked" plus the little
// sha256 manifest that lets the backfill scripts skip already-stamped files and
// lets the prebuild guard fail if anything in scope is unstamped.
//
// The manifest maps a public-relative path -> sha256 of the *watermarked* bytes.
// A file whose current sha equals its manifest entry is considered done.

export const REPO_ROOT = process.cwd()
export const PUBLIC_DIR = join(REPO_ROOT, 'public')
export const MANIFEST_PATH = join(REPO_ROOT, 'scripts', 'watermark-manifest.json')

export type AssetKind = 'image' | 'video' | 'pdf'

// Directories (under public/) to scan, and which extensions in each count as which kind.
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.avif', '.webp'])
const SCAN: { dir: string; kinds: Partial<Record<AssetKind, Set<string>>> }[] = [
  { dir: 'media', kinds: { image: IMAGE_EXTS } },
  { dir: 'student-work', kinds: { image: IMAGE_EXTS } },
  { dir: 'team', kinds: { image: IMAGE_EXTS } },
  // Video posters / thumbnails live alongside the mp4s; the mp4s themselves are re-encoded.
  { dir: 'videos', kinds: { image: new Set(['.jpg', '.jpeg', '.png']), video: new Set(['.mp4']) } },
  // PDF cover thumbnails + the downloadable PDFs.
  { dir: 'files', kinds: { image: new Set(['.jpg', '.jpeg', '.png']), pdf: new Set(['.pdf']) } },
]

export interface Target {
  /** Absolute path on disk. */
  abs: string
  /** public-relative path with forward slashes, e.g. "media/home-hero-1200.avif". */
  rel: string
  kind: AssetKind
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function toPosixRel(abs: string): string {
  return relative(PUBLIC_DIR, abs).split(sep).join(posix.sep)
}

/** Every /public asset that must carry a watermark, optionally filtered by kind. */
export function listTargets(kinds?: AssetKind[]): Target[] {
  const want = kinds ? new Set(kinds) : null
  const targets: Target[] = []
  for (const { dir, kinds: kindMap } of SCAN) {
    for (const abs of walk(join(PUBLIC_DIR, dir))) {
      const ext = extname(abs).toLowerCase()
      for (const [kind, exts] of Object.entries(kindMap) as [AssetKind, Set<string>][]) {
        if (exts.has(ext) && (!want || want.has(kind))) {
          targets.push({ abs, rel: toPosixRel(abs), kind })
          break
        }
      }
    }
  }
  return targets
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function fileSha(abs: string): string {
  return sha256(readFileSync(abs))
}

export function loadManifest(): Record<string, string> {
  if (!existsSync(MANIFEST_PATH)) return {}
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

export function saveManifest(manifest: Record<string, string>): void {
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(MANIFEST_PATH, JSON.stringify(sorted, null, 2) + '\n')
}
