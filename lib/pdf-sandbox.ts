import { Worker } from 'node:worker_threads'
import type { PdfJob, PdfJobReply } from './pdf-sandbox-worker'

// pdf-lib, run on bytes a member uploaded, in a worker thread with a heap limit
// and a wall-clock timeout.
//
// Why: pdf-lib trusts the file. Three rounds of a static pre-scan
// (lib/pdf-page-count.ts) were each answered by a new crafted PDF that made
// PDFDocument.load loop for seconds per object, or allocate until the process
// died — and on the main thread either one stalls every request the instance
// is serving, or kills it. The scan still refuses what it can see. This is the
// bound that doesn't depend on seeing everything: whatever a file makes pdf-lib
// do, it does it on another thread, in at most PDF_WORKER_HEAP_MB of heap, for
// at most PDF_WORKER_TIMEOUT_MS. Then the thread is terminated and the upload
// refused.
//
// Cost: a worker that times out burns up to one CPU core for the timeout (8 s)
// on its own thread, then is terminated; the main event loop keeps serving.
// Starting a worker costs ~50 ms. At most PDF_WORKER_CONCURRENCY run at once
// per instance, so a burst of crafted uploads can't stack heaps past the
// function's memory; the rest wait their turn (the timeout starts when a job's
// worker does).
//
// The worker entry is `new Worker(new URL('./pdf-sandbox-worker.ts',
// import.meta.url))`, written out in full: Turbopack recognises that exact
// shape and emits the worker, pdf-lib and all, as its own chunk next to the
// route's (verified with `next build` + `next start` on 3 Nov 2026: the route's
// .nft.json lists the "[worker thread]" chunk, so Vercel ships it). Under
// vitest the URL is the .ts source, which Node runs with tsx.

/** How long one PDF job may run, worker start-up included. */
export const PDF_WORKER_TIMEOUT_MS = 8_000
/** The worker's old-generation heap. A 25 MB PDF stamps in well under this. */
export const PDF_WORKER_HEAP_MB = 256
/** The worker's young-generation heap. */
export const PDF_WORKER_YOUNG_MB = 64
/** Workers running at once, per instance. */
export const PDF_WORKER_CONCURRENCY = 2

/**
 * Why a job didn't produce a result:
 *   - invalid: pdf-lib threw — a damaged or unsupported file, nothing worse.
 *   - timeout: still running at the timeout; terminated.
 *   - memory:  hit the heap limit; the thread died.
 *   - crash:   the thread died any other way (or couldn't start).
 * The last three are what the sandbox exists for: the caller refuses the file.
 */
export type PdfSandboxFailure = 'invalid' | 'timeout' | 'memory' | 'crash'

export type PdfSandboxResult<T> = { ok: true; value: T } | { ok: false; reason: PdfSandboxFailure; detail: string }

type RunOptions = {
  timeoutMs?: number
  heapMb?: number
  /** Lets the worker run its test-only jobs. Never set outside tests. */
  allowTestOps?: boolean
}

// ── Concurrency ─────────────────────────────────────────────────────────────

let running = 0
const waiting: Array<() => void> = []

async function acquire(): Promise<void> {
  if (running < PDF_WORKER_CONCURRENCY) {
    running++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

// ── One job ─────────────────────────────────────────────────────────────────

function startWorker(opts: RunOptions): Worker {
  const options = {
    workerData: { allowTestOps: Boolean(opts.allowTestOps) },
    resourceLimits: {
      maxOldGenerationSizeMb: opts.heapMb ?? PDF_WORKER_HEAP_MB,
      maxYoungGenerationSizeMb: PDF_WORKER_YOUNG_MB,
    },
    stdout: false,
    stderr: false,
  }
  // Under vitest the worker is the .ts source, compiled by tsx. (Vitest's jsdom
  // environment rewrites `new URL(…, import.meta.url)` to an http URL, so the
  // path is built from the directory instead.)
  if (process.env.VITEST) {
    return new Worker(`${import.meta.dirname}/pdf-sandbox-worker.ts`, { ...options, execArgv: ['--import', 'tsx'] })
  }
  // In a Next build this exact shape is what Turbopack turns into the worker
  // chunk. (@vite-ignore: Vite's web-worker transform, which never runs this
  // branch, otherwise refuses options it can't read statically.)
  return new Worker(new URL('./pdf-sandbox-worker.ts', import.meta.url), /* @vite-ignore */ options)
}

async function runJob(job: PdfJob, opts: RunOptions = {}): Promise<PdfSandboxResult<PdfJobReply & { ok: true }>> {
  await acquire()
  try {
    return await new Promise((resolve) => {
      let settled = false
      let worker: Worker | undefined
      const finish = (result: PdfSandboxResult<PdfJobReply & { ok: true }>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        // Terminate in every case: a worker that replied is done; one that
        // didn't is stopped mid-loop (V8 interrupts running JS).
        void worker?.terminate().catch(() => {})
        resolve(result)
      }
      const timer = setTimeout(
        () => finish({ ok: false, reason: 'timeout', detail: `no result in ${opts.timeoutMs ?? PDF_WORKER_TIMEOUT_MS} ms` }),
        opts.timeoutMs ?? PDF_WORKER_TIMEOUT_MS,
      )
      try {
        worker = startWorker(opts)
      } catch (err) {
        finish({ ok: false, reason: 'crash', detail: `worker did not start: ${String(err)}` })
        return
      }
      worker.once('message', (reply: PdfJobReply) => {
        if (reply.ok) finish({ ok: true, value: reply })
        else finish({ ok: false, reason: 'invalid', detail: reply.error })
      })
      worker.once('error', (err: Error & { code?: string }) => {
        const memory = err.code === 'ERR_WORKER_OUT_OF_MEMORY'
        finish({ ok: false, reason: memory ? 'memory' : 'crash', detail: `${err.code ?? err.name}: ${err.message}` })
      })
      worker.once('exit', (code) => finish({ ok: false, reason: 'crash', detail: `worker exited (${code}) without a result` }))
      // The bytes are copied, not transferred: the caller still owns its buffer.
      worker.postMessage(job)
    })
  } finally {
    release()
  }
}

/**
 * Log a job the sandbox had to stop. To the console, and to app_errors (lib/
 * app-errors.ts) so it outlives Vercel's hour of logs. Never throws.
 */
async function report(purpose: string, failure: { reason: PdfSandboxFailure; detail: string }): Promise<void> {
  if (failure.reason === 'invalid') return
  console.error(`[pdf-sandbox] ${purpose}: ${failure.reason} — ${failure.detail}`)
  try {
    const { captureRequestError } = await import('@/lib/app-errors')
    await captureRequestError(
      new Error(`PDF sandbox stopped a ${purpose} job: ${failure.reason}`),
      { method: 'POST', path: 'pdf-sandbox' },
      { routePath: `pdf-sandbox/${purpose}`, routeType: 'route' },
    )
  } catch (err) {
    console.error('[pdf-sandbox] could not record the failure:', err)
  }
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/**
 * Load a PDF and count its page tree (lib/watermark/pdf countPageTree), in the
 * sandbox. `value` is the count, past `maxPages` at most one over, or null for
 * a tree that repeats a node or can't be walked.
 */
export async function countPdfPagesSandboxed(
  bytes: Uint8Array,
  maxPages: number,
  opts?: RunOptions,
): Promise<PdfSandboxResult<number | null>> {
  const result = await runJob({ op: 'count', bytes, maxPages }, opts)
  if (!result.ok) {
    await report('page count', result)
    return result
  }
  return result.value.op === 'count'
    ? { ok: true, value: result.value.pages }
    : { ok: false, reason: 'crash', detail: 'wrong reply' }
}

/** Stamp a PDF's pages with the copyright mark (lib/watermark/pdf stampPdfBytes), in the sandbox. */
export async function stampPdfSandboxed(bytes: Uint8Array, opts?: RunOptions): Promise<PdfSandboxResult<Uint8Array>> {
  const result = await runJob({ op: 'stamp', bytes }, opts)
  if (!result.ok) {
    await report('watermark', result)
    return result
  }
  return result.value.op === 'stamp'
    ? { ok: true, value: result.value.bytes }
    : { ok: false, reason: 'crash', detail: 'wrong reply' }
}

/** Test hook: a worker that allocates until its heap limit kills it. */
export async function exhaustMemorySandboxed(opts: RunOptions): Promise<PdfSandboxResult<never>> {
  const result = await runJob({ op: 'exhaust-memory' }, { ...opts, allowTestOps: true })
  if (!result.ok) await report('memory test', result)
  return result.ok ? { ok: false, reason: 'crash', detail: 'unexpected reply' } : result
}
