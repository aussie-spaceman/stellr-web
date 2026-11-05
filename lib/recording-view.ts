// What a recording's state means to the person looking at it. Pure, so the
// wording and the timeouts can be tested without a database or a browser.
//
// A row can be left behind: a function killed mid-copy stays 'saving', and a tab
// that crashed stays 'recording'. Those are read as failures here, at read time,
// so nobody watches a spinner for a job that is no longer running.

export type RecordingPhase = 'none' | 'recording' | 'processing' | 'saving' | 'failed' | 'saved'

export interface OffloadRow {
  status: 'recording' | 'processing' | 'saving' | 'failed' | 'saved'
  source_url?: string | null
  source_expires_at?: string | null
  error?: string | null
  size_bytes?: number | null
  updated_at: string
}

export interface RecordingView {
  phase: RecordingPhase
  message: string
  /** Whether a saved file exists right now, whatever a newer attempt is doing. */
  hasFile: boolean
  canRetry: boolean
  /** ISO time the JaaS link dies. Only set when canRetry is true. */
  retryUntil: string | null
  sizeBytes: number | null
}

const MINUTE = 60_000

/** A copy runs for at most the 300 s function limit, so older than this is dead. */
export const SAVING_STALE_MS = 6 * MINUTE
/** JaaS normally delivers within a minute of the room ending. */
export const PROCESSING_STALE_MS = 30 * MINUTE
/** JaaS's own limit on one recording. */
export const RECORDING_STALE_MS = 6 * 60 * MINUTE

const COPY: Record<RecordingPhase, string> = {
  none: 'No recording yet.',
  recording: 'Recording in progress. Keep the session open until you finish.',
  processing: 'Recording finished. Waiting for the file from JaaS, which usually takes a minute or two. It is safe to leave this page.',
  saving: 'Saving the recording to this lesson. It is safe to leave this page.',
  failed: 'The recording could not be saved.',
  saved: 'Recording saved to this lesson.',
}

export function recordingView(
  item: { recording_status?: string | null; recording_path?: string | null },
  row: OffloadRow | null,
  now = Date.now(),
): RecordingView {
  const hasFile = item.recording_status === 'available' && !!item.recording_path
  const base = { hasFile, canRetry: false, retryUntil: null, sizeBytes: row?.size_bytes ?? null }

  if (!row) {
    return hasFile
      ? { ...base, phase: 'saved', message: COPY.saved }
      : { ...base, phase: 'none', message: COPY.none }
  }

  const age = now - new Date(row.updated_at).getTime()
  const linkAlive =
    !!row.source_url && !!row.source_expires_at && new Date(row.source_expires_at).getTime() > now
  const retry = linkAlive ? { canRetry: true, retryUntil: row.source_expires_at ?? null } : {}
  const orReRecord = linkAlive ? '' : ' JaaS only keeps a recording for 24 hours, so this one needs to be recorded again.'

  switch (row.status) {
    case 'recording':
      if (age > RECORDING_STALE_MS) {
        return { ...base, phase: 'failed', message: 'This session never reported an end, and no file arrived from JaaS. Record it again.' }
      }
      return { ...base, phase: 'recording', message: COPY.recording }
    case 'processing':
      if (age > PROCESSING_STALE_MS) {
        return { ...base, phase: 'failed', message: 'No file has arrived from JaaS 30 minutes after the session ended. If it still has not appeared later today, record it again.' }
      }
      return { ...base, phase: 'processing', message: COPY.processing }
    case 'saving':
      if (age > SAVING_STALE_MS) {
        return { ...base, ...retry, phase: 'failed', message: `Saving stopped before it finished.${orReRecord}` }
      }
      return { ...base, phase: 'saving', message: COPY.saving }
    case 'failed':
      return { ...base, ...retry, phase: 'failed', message: `${row.error || COPY.failed}${orReRecord}` }
    case 'saved':
      return hasFile
        ? { ...base, phase: 'saved', message: COPY.saved }
        : { ...base, phase: 'none', message: COPY.none }
  }
}
