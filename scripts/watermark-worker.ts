/**
 * Video watermark worker.
 *
 * Vercel can't run ffmpeg, so private access-gated videos (JaaS session/training
 * recordings + admin-uploaded training-lesson videos) are enqueued into
 * `video_watermark_jobs` by the request paths. This worker — run on any box with
 * ffmpeg (a container, a cron host, a laptop) — claims pending jobs, downloads the
 * object from Supabase Storage, burns "© Stellr Education" into the bottom-right,
 * and overwrites the same path in place.
 *
 * Env (from .env.local or the environment):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (required)
 *   FFMPEG_PATH                                           (optional; else ffmpeg-static / system ffmpeg)
 *
 *   npx tsx scripts/watermark-worker.ts            # continuous: poll every 15s
 *   npx tsx scripts/watermark-worker.ts --once     # single drain pass, then exit (cron)
 */
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { watermarkVideoFile } from '../lib/watermark/video'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('❌  NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  process.exit(1)
}

const MAX_ATTEMPTS = 3
const BATCH = 3
const POLL_MS = 15_000

interface Job {
  id: string
  bucket: string
  storage_path: string
  kind: string
  attempts: number
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Atomically claim a pending job by flipping it to 'processing' (skip if lost the race). */
async function claim(db: SupabaseClient, job: Job): Promise<boolean> {
  const { data } = await db
    .from('video_watermark_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id')
  return !!data && data.length > 0
}

async function processJob(db: SupabaseClient, job: Job): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'stellr-wm-job-'))
  const inPath = path.join(dir, 'in.mp4')
  const outPath = path.join(dir, 'out.mp4')
  try {
    const { data, error } = await db.storage.from(job.bucket).download(job.storage_path)
    if (error || !data) throw new Error(`download failed: ${error?.message ?? 'no data'}`)
    writeFileSync(inPath, Buffer.from(await data.arrayBuffer()))

    await watermarkVideoFile(inPath, outPath)

    const { error: upErr } = await db.storage
      .from(job.bucket)
      .upload(job.storage_path, readFileSync(outPath), { contentType: 'video/mp4', upsert: true })
    if (upErr) throw upErr

    await db
      .from('video_watermark_jobs')
      .update({ status: 'done', last_error: null, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    console.log(`  ✓ ${job.storage_path}`)
  } catch (err) {
    const attempts = job.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    await db
      .from('video_watermark_jobs')
      .update({
        status: failed ? 'failed' : 'pending',
        attempts,
        last_error: (err as Error).message.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    console.error(`  ✗ ${job.storage_path} (attempt ${attempts}${failed ? ', giving up' : ''}): ${(err as Error).message.slice(0, 160)}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Drain currently-pending jobs. Returns how many were processed. */
async function drain(db: SupabaseClient): Promise<number> {
  let handled = 0
  for (;;) {
    const { data: jobs } = await db
      .from('video_watermark_jobs')
      .select('id, bucket, storage_path, kind, attempts')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH)
    if (!jobs || jobs.length === 0) break
    for (const job of jobs as Job[]) {
      if (await claim(db, job)) {
        await processJob(db, job)
        handled++
      }
    }
  }
  return handled
}

async function main() {
  const db = createClient(url!, serviceKey!, { auth: { persistSession: false } })
  const once = process.argv.includes('--once')

  if (once) {
    const n = await drain(db)
    console.log(`watermark worker: drained ${n} job(s).`)
    return
  }

  console.log('watermark worker: polling for video jobs (ctrl-c to stop)…')
  for (;;) {
    const n = await drain(db)
    if (n > 0) console.log(`  processed ${n} job(s)`)
    await sleep(POLL_MS)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
