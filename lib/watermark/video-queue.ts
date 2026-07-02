import type { SupabaseClient } from '@supabase/supabase-js'

// Enqueue a stored video for watermarking by scripts/watermark-worker.ts.
//
// Called from the request path (recording offload webhook + training-lesson video
// upload) where ffmpeg can't run. Best-effort: a failure to enqueue is logged but
// never blocks the upload response — the file is already stored, and a missed job
// can be re-enqueued or picked up by a backfill.

export type VideoWatermarkKind = 'recording' | 'training'

export async function enqueueVideoWatermark(
  db: SupabaseClient,
  bucket: string,
  storagePath: string,
  kind: VideoWatermarkKind
): Promise<void> {
  const { error } = await db.from('video_watermark_jobs').upsert(
    {
      bucket,
      storage_path: storagePath,
      kind,
      status: 'pending',
      attempts: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'storage_path' }
  )
  if (error) console.error('[watermark] failed to enqueue video job:', storagePath, error)
}
