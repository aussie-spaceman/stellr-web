import { parentPort, workerData } from 'node:worker_threads'
import { PDFDocument } from 'pdf-lib'
import { countPageTree, stampPdfBytes } from './watermark/pdf'

// The worker thread lib/pdf-sandbox.ts runs pdf-lib in. Everything here sees
// bytes a member uploaded, so it runs off the main event loop, under the heap
// limits and wall-clock timeout the parent sets: a file that makes pdf-lib loop
// or allocate without end costs this thread, never a request.
//
// Imports are relative (no `@/`): under vitest the parent starts this file with
// tsx, which resolves them as Next's bundler does.
//
// One job per worker: the parent posts { op, bytes, ... } once and terminates
// the thread after the reply (or when the timeout fires first).

export type PdfJob =
  | { op: 'count'; bytes: Uint8Array; maxPages: number }
  | { op: 'stamp'; bytes: Uint8Array }
  /** Allocates until the heap limit kills the thread. Honoured only when the parent allows test ops. */
  | { op: 'exhaust-memory' }

export type PdfJobReply =
  | { ok: true; op: 'count'; pages: number | null }
  | { ok: true; op: 'stamp'; bytes: Uint8Array }
  | { ok: false; error: string }

const port = parentPort
if (!port) throw new Error('pdf-sandbox-worker must run as a worker thread')
const allowTestOps = Boolean((workerData as { allowTestOps?: boolean } | null)?.allowTestOps)

async function run(job: PdfJob): Promise<PdfJobReply> {
  if (job.op === 'count') {
    const doc = await PDFDocument.load(job.bytes, { ignoreEncryption: true, updateMetadata: false })
    return { ok: true, op: 'count', pages: countPageTree(doc, job.maxPages) }
  }
  if (job.op === 'stamp') return { ok: true, op: 'stamp', bytes: await stampPdfBytes(job.bytes) }
  if (job.op === 'exhaust-memory' && allowTestOps) {
    const hold: unknown[] = []
    for (;;) hold.push(new Array(1_000_000).fill({ hold }))
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
