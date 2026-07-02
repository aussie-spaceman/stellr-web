import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WATERMARK_TEXT } from './config'

// Burns "© Stellr Education" into the bottom-right corner of a video via ffmpeg's
// drawtext filter. Used by the /public/videos backfill and as the pre-upload
// pass for any master destined for YouTube/Vimeo (the platforms won't add it for
// us, so the mark has to be in the file before it leaves).
//
// ffmpeg is resolved from `ffmpeg-static` when installed, else the FFMPEG_PATH
// env var, else a system `ffmpeg` on PATH. Text is passed via a temp `textfile`
// so the © glyph and spaces don't need shell/filter escaping.

async function resolveFfmpeg(): Promise<string> {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  try {
    const mod = await import('ffmpeg-static')
    const p = (mod.default ?? mod) as unknown as string | null
    if (p) return p
  } catch {
    // ffmpeg-static not installed — fall back to a system ffmpeg.
  }
  return 'ffmpeg'
}

function fontArg(): string | null {
  // drawtext needs a font file. Prefer an explicit override, else a common macOS/Linux face.
  const candidates = [
    process.env.WATERMARK_FONT,
    '/System/Library/Fonts/Supplemental/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/Library/Fonts/Arial.ttf',
  ].filter(Boolean) as string[]
  return candidates[0] ?? null
}

export interface WatermarkVideoOptions {
  /** ffmpeg CRF (quality); lower = better/larger. Default 20. */
  crf?: number
  /** x264 preset. Default 'veryfast'. */
  preset?: string
}

/**
 * Re-encode `inPath` with the watermark burned in, writing to `outPath`.
 * Audio is stream-copied. Resolves when ffmpeg exits 0, rejects otherwise.
 */
export async function watermarkVideoFile(inPath: string, outPath: string, opts: WatermarkVideoOptions = {}): Promise<void> {
  const ffmpeg = await resolveFfmpeg()
  const dir = await mkdtemp(join(tmpdir(), 'stellr-wm-'))
  const textPath = join(dir, 'wm.txt')
  await writeFile(textPath, WATERMARK_TEXT, 'utf8')

  // Font size + margin scale with video height; shadow keeps it legible.
  const font = fontArg()
  const drawtext = [
    font ? `fontfile='${font.replace(/'/g, "\\'")}'` : null,
    `textfile='${textPath.replace(/'/g, "\\'")}'`,
    'fontcolor=white@0.9',
    'shadowcolor=black@0.5',
    'shadowx=2',
    'shadowy=2',
    'fontsize=h*0.035',
    'x=w-tw-(h*0.03)',
    'y=h-th-(h*0.03)',
  ]
    .filter(Boolean)
    .join(':')

  const args = [
    '-y',
    '-i', inPath,
    '-vf', `drawtext=${drawtext}`,
    '-c:v', 'libx264',
    '-crf', String(opts.crf ?? 20),
    '-preset', opts.preset ?? 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    outPath,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      proc.stderr.on('data', (d) => { stderr += d.toString() })
      proc.on('error', reject)
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`))))
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
