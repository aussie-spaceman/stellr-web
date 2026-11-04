import { parentPort, workerData } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
import { checkLoadInflation } from './pdf-scan'
import { countPageTree, stampPdfBytes } from './watermark/pdf'

// The worker thread lib/pdf-sandbox.ts runs pdf-lib in. Everything here sees
// bytes a member uploaded, so it runs off the main event loop, under the heap
// limits, memory watchdog and wall-clock timeout the parent sets: a file that
// makes pdf-lib loop or allocate without end costs this thread, never a
// request.
//
// Before pdf-lib opens anything, the file goes through the scan's bound on
// what a load inflates (lib/pdf-scan.ts checkLoadInflation: LOAD_INFLATE_BUDGET
// in all, MAX_INFLATE_RATIO a stream), here, whatever the caller checked —
// which no heap limit bounds. A file it refuses is never loaded. (Not the
// whole page-count scan: files no page cap applies to, an admin's, come here
// too, and the scan refuses some ordinary ones for reasons a load doesn't
// care about.)
//
// Imports are relative (no `@/`): under vitest the parent starts this file with
// tsx, which resolves them as Next's bundler does.
//
// One job per worker: the parent posts { op, bytes, ... } once and terminates
// the thread after the reply (or when the timeout or the watchdog fires first).

export type PdfJob = (
  | { op: 'count'; bytes: Uint8Array; maxPages: number }
  | { op: 'stamp'; bytes: Uint8Array }
  /** Allocates heap until the heap limit kills the thread. Honoured only when the parent allows test ops. */
  | { op: 'exhaust-memory' }
  /** Allocates ArrayBuffers until the watchdog stops the thread. Honoured only when the parent allows test ops. */
  | { op: 'exhaust-buffers' }
) & {
  /** Load without the scan. Honoured only when the parent allows test ops. */
  skipScan?: boolean
}

export type PdfJobReply =
  | { ok: true; op: 'count'; pages: number | null }
  | { ok: true; op: 'stamp'; bytes: Uint8Array }
  /** `refused`: the scan refused the file; pdf-lib never opened it. */
  | { ok: false; error: string; refused?: boolean }

const port = parentPort
if (!port) throw new Error('pdf-sandbox-worker must run as a worker thread')
const allowTestOps = Boolean((workerData as { allowTestOps?: boolean } | null)?.allowTestOps)

/** Why the scan won't let pdf-lib open these bytes, or null when it will. */
function scanRefuses(bytes: Uint8Array, job: PdfJob): string | null {
  if (job.skipScan && allowTestOps) return null
  return checkLoadInflation(bytes) === null ? 'the pre-load scan refused the file: past what a load may inflate' : null
}

async function run(job: PdfJob): Promise<PdfJobReply> {
  if (job.op === 'count' || job.op === 'stamp') {
    const refused = scanRefuses(job.bytes, job)
    if (refused) return { ok: false, error: refused, refused: true }
  }
  if (job.op === 'count') {
    const doc = await PDFDocument.load(job.bytes, { ignoreEncryption: true, updateMetadata: false })
    return { ok: true, op: 'count', pages: countPageTree(doc, job.maxPages) }
  }
  if (job.op === 'stamp') return { ok: true, op: 'stamp', bytes: await stampPdfBytes(job.bytes) }
  if (job.op === 'exhaust-memory' && allowTestOps) {
    const hold: unknown[] = []
    for (;;) hold.push(new Array(1_000_000).fill({ hold }))
  }
  if (job.op === 'exhaust-buffers' && allowTestOps) {
    // 1 MB every 2 ms, held — about the pace pdf-lib inflates at: the heap
    // stays small, the buffers don't.
    const hold: Uint8Array[] = []
    for (;;) {
      hold.push(new Uint8Array(1024 * 1024).fill(1))
      const until = performance.now() + 2
      while (performance.now() < until);
    }
  }
  return { ok: false, error: 'unknown job' }
}

port.once('message', (job: PdfJob) => {
  // pdf-lib warns on every odd number it reads; a crafted file can print
  // thousands of lines. Nothing it says here is needed.
  console.warn = () => {}
  run(job).then(
    (reply) => {
      if (reply.ok && reply.op === 'stamp') port.postMessage(reply, [reply.bytes.buffer as ArrayBuffer])
      else port.postMessage(reply)
    },
    (err: unknown) => port.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  )
})
