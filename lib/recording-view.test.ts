import { describe, it, expect } from 'vitest'
import { PROCESSING_STALE_MS, RECORDING_STALE_MS, SAVING_STALE_MS, recordingView, type OffloadRow } from './recording-view'

const NOW = Date.parse('2026-11-04T20:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const inFuture = new Date(NOW + 3_600_000).toISOString()
const row = (r: Partial<OffloadRow>): OffloadRow => ({ status: 'saving', updated_at: ago(0), ...r })
const none = { recording_status: 'none', recording_path: null }
const saved = { recording_status: 'available', recording_path: 'recordings/x.mp4' }

describe('recordingView', () => {
  it('reads a lesson with no row from its own columns', () => {
    expect(recordingView(none, null, NOW).phase).toBe('none')
    expect(recordingView(saved, null, NOW)).toMatchObject({ phase: 'saved', hasFile: true })
  })

  it('shows a live job as it is', () => {
    expect(recordingView(none, row({ status: 'recording' }), NOW).phase).toBe('recording')
    expect(recordingView(none, row({ status: 'processing' }), NOW).phase).toBe('processing')
    expect(recordingView(none, row({ status: 'saving' }), NOW).phase).toBe('saving')
  })

  it('a copy older than the function limit is a failure, retryable while the link lives', () => {
    const v = recordingView(none, row({ status: 'saving', updated_at: ago(SAVING_STALE_MS + 1), source_url: 'https://x', source_expires_at: inFuture }), NOW)
    expect(v).toMatchObject({ phase: 'failed', canRetry: true, retryUntil: inFuture })
  })

  it('gives up waiting for JaaS, without offering a retry there is no link for', () => {
    const v = recordingView(none, row({ status: 'processing', updated_at: ago(PROCESSING_STALE_MS + 1) }), NOW)
    expect(v).toMatchObject({ phase: 'failed', canRetry: false })
  })

  it('does not leave a crashed tab recording forever', () => {
    expect(recordingView(none, row({ status: 'recording', updated_at: ago(RECORDING_STALE_MS + 1) }), NOW).phase).toBe('failed')
  })

  it('a failure says why, and offers a retry only while the link is alive', () => {
    const alive = recordingView(none, row({ status: 'failed', error: 'Too big.', source_url: 'https://x', source_expires_at: inFuture }), NOW)
    expect(alive).toMatchObject({ phase: 'failed', canRetry: true })
    expect(alive.message).toBe('Too big.')

    const dead = recordingView(none, row({ status: 'failed', error: 'Too big.', source_url: 'https://x', source_expires_at: ago(1) }), NOW)
    expect(dead.canRetry).toBe(false)
    expect(dead.message).toMatch(/recorded again/)
  })

  it('a failed replacement keeps the saved file in view', () => {
    expect(recordingView(saved, row({ status: 'failed', error: 'x' }), NOW)).toMatchObject({ phase: 'failed', hasFile: true })
  })

  it('a saved row with no file reads as none', () => {
    expect(recordingView(none, row({ status: 'saved' }), NOW).phase).toBe('none')
  })
})
