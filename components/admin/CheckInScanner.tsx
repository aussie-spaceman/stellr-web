'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, cn } from '@stellr/web-ui'
import { flagChips } from '@/components/admin/CheckInFlags'
import { codeFromScan, type DeskFlags } from '@/lib/check-in-desk'

// The desk's camera scanner (Oct 2026). It reads a participant's or a group's
// check-in code (lib/check-in-codes.ts) from a badge, a phone screen or a print,
// and keeps scanning so a line can be worked without touching the screen.
//
// Safari has no built-in barcode reader (the Shape Detection API is still
// behind a flag), so the barcode-detector package runs the zxing reader as
// WebAssembly, served from our own site (scripts/copy-scanner-wasm.mjs) so it
// also works from the desk's offline cache. It is used everywhere, even where a
// browser has its own reader: one path on every device, and in testing it read
// a code in about 240 ms where Chrome's own took 0.3–6 s (30 Oct 2026).

export interface ScanOutcome {
  tone: 'ok' | 'warn' | 'error'
  title: string
  detail?: string
  flags?: DeskFlags
}

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

const SCAN_EVERY_MS = 180
/** The same code seen again within this window is the same badge still in view. */
const REPEAT_MS = 4000
const RESULT_MS = 3500

async function makeDetector(): Promise<Detector> {
  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill')
  setZXingModuleOverrides({
    locateFile: (file: string, prefix: string) => (file.endsWith('.wasm') ? '/vendor/zxing_reader.wasm' : prefix + file),
  })
  return new BarcodeDetector({ formats: ['qr_code'] }) as unknown as Detector
}

export default function CheckInScanner({
  onCode,
  onClose,
}: {
  /** Handles a code read from the camera. null when it has taken over (a group code opens its list). */
  onCode: (code: string) => Promise<ScanOutcome | null>
  onClose: () => void
}) {
  // A state ref, not useRef: the Dialog renders its body a tick after it mounts,
  // so the camera starts when the <video> actually exists.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const doneRef = useRef<HTMLButtonElement>(null)
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode
  const [status, setStatus] = useState<'starting' | 'scanning' | 'blocked' | 'unavailable'>('starting')
  const [result, setResult] = useState<ScanOutcome | null>(null)

  useEffect(() => {
    if (!video) return
    const el: HTMLVideoElement = video
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let resultTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let busy = false
    const lastSeen = new Map<string, number>()

    const show = (outcome: ScanOutcome) => {
      setResult(outcome)
      if (resultTimer) clearTimeout(resultTimer)
      resultTimer = setTimeout(() => setResult(null), RESULT_MS)
      if (outcome.tone === 'ok') navigator.vibrate?.(60)
      else navigator.vibrate?.([80, 60, 80])
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch {
        if (!stopped) setStatus('blocked')
        return
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      el.srcObject = stream
      await el.play().catch(() => {})

      let detector: Detector
      try {
        detector = await makeDetector()
      } catch {
        if (!stopped) setStatus('unavailable')
        return
      }
      if (stopped) return
      setStatus('scanning')

      const tick = async () => {
        if (stopped) return
        if (!busy && el.readyState >= 2) {
          busy = true
          try {
            const [hit] = await detector.detect(el)
            const raw = hit?.rawValue?.trim()
            if (raw) {
              const now = Date.now()
              const seen = lastSeen.get(raw)
              lastSeen.set(raw, now)
              if (!seen || now - seen > REPEAT_MS) {
                const code = codeFromScan(raw)
                if (!code) show({ tone: 'error', title: 'Not a Stellr check-in code', detail: 'Search by name instead.' })
                else {
                  const outcome = await onCodeRef.current(code)
                  if (outcome) show(outcome)
                }
              }
            }
          } catch {
            /* a frame the reader couldn't use; try the next */
          } finally {
            busy = false
          }
        }
        timer = setTimeout(tick, SCAN_EVERY_MS)
      }
      tick()
    }
    start()

    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      if (resultTimer) clearTimeout(resultTimer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [video])

  return (
    <Dialog
      open
      onClose={onClose}
      title="Scan check-in codes"
      description="Point the camera at a badge, a phone screen or a printed code. It keeps scanning."
      initialFocusRef={doneRef}
      size="md"
      footer={
        <Button ref={doneRef} onClick={onClose} className="min-h-12 px-5 py-2">
          Done
        </Button>
      }
    >
      <div className="relative overflow-hidden rounded-control bg-midnight">
        <video ref={setVideo} playsInline muted className="block aspect-[4/3] w-full object-cover" aria-label="Camera view" />
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-[18%] rounded-ds-card border-4 border-white/80" aria-hidden />
        )}
        {status !== 'scanning' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
            {status === 'starting' && 'Starting the camera…'}
            {status === 'blocked' &&
              'The camera is blocked. Allow camera access for this site in the browser settings, or search by name instead.'}
            {status === 'unavailable' && 'This browser can’t scan codes. Search by name instead.'}
          </div>
        )}
      </div>
      <div
        role="status"
        aria-live="assertive"
        className={cn(
          'mt-3 min-h-[5.5rem] rounded-control px-4 py-3',
          !result && 'bg-surface text-content-muted',
          result?.tone === 'ok' && 'bg-enviro-green-bg text-enviro-green-text',
          result?.tone === 'warn' && 'bg-pathway-amber-bg text-gold-ink',
          result?.tone === 'error' && 'bg-danger/10 text-danger'
        )}
      >
        {result ? (
          <>
            <p className="font-display text-xl font-bold leading-tight">{result.title}</p>
            {result.detail && <p className="mt-0.5 text-sm font-medium">{result.detail}</p>}
            {result.flags && (
              <p className="mt-1.5 flex flex-wrap gap-1.5">
                {flagChips(result.flags).map((c) => (
                  <span key={c.key} className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', c.className)}>
                    {c.label}
                  </span>
                ))}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">{status === 'scanning' ? 'Ready. Hold a code inside the frame.' : ' '}</p>
        )}
      </div>
    </Dialog>
  )
}
