import { scanPdfPages } from './pdf-scan'

// Whether a member's PDF is within the page cap, judged before pdf-lib opens
// it on the main thread — which it never does.
//
// The bounded, linear pre-scan that does most of the work (and bounds what a
// pdf-lib load could inflate) is lib/pdf-scan.ts, kept apart so the sandbox
// worker (lib/pdf-sandbox-worker.ts) can run it again without importing the
// sandbox. Everything it exports is re-exported here.

export * from './pdf-scan'

/** The most pages a PDF a member uploads may have (owner decision, 3 Nov 2026). */
export const MAX_MEMBER_PDF_PAGES = 50

export const PDF_TOO_MANY_PAGES = `PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Upload a shorter version, or split it into parts.`
export const PDF_PAGES_UNKNOWN = `We couldn’t count the pages in that PDF, and PDFs can be up to ${MAX_MEMBER_PDF_PAGES} pages. Save it again as a PDF (Print › Save as PDF works) and upload that copy.`

/** More `/Type /Page` than this many times the cap is refused without loading. */
export const PAGE_SCAN_HEADROOM = 5

/** The most objects a file may have for checkPdfPageLimit to load it (~0.2s of pdf-lib). */
export const LOAD_OBJECT_LIMIT = 10_000

/**
 * 'failed': the sandbox had to stop pdf-lib on this file (it ran past the
 * timeout, the heap limit or the memory watchdog, the worker died, or the
 * worker's own scan refused it). Refused like 'unknown', with
 * PDF_UNPROCESSABLE.
 *
 * 'busy': every sandbox slot stayed taken past PDF_QUEUE_MAX_WAIT_MS. Refused
 * with PDF_BUSY (503): the file wasn't judged, and may be fine a minute later.
 */
export type PdfPageCheck = 'ok' | 'over' | 'unknown' | 'failed' | 'busy'

/** Shown when the sandbox (lib/pdf-sandbox.ts) had to stop pdf-lib on a file. */
export const PDF_UNPROCESSABLE =
  'We couldn’t process that PDF. Save it again as a PDF (Print › Save as PDF works) and upload that copy.'

/** Shown, with a 503, when the sandbox had no free slot in time (lib/pdf-sandbox.ts PDF_QUEUE_MAX_WAIT_MS). */
export const PDF_BUSY = 'We’re busy processing PDFs — please try again in a minute.'

/**
 * Whether a PDF fits within `maxPages`. The scan's bound decides most files.
 * A bound over the cap is settled by loading the file with pdf-lib and
 * counting its page tree — when the scan has bounded that load's objects, and
 * always in the sandbox (lib/pdf-sandbox.ts): pdf-lib never runs on a member's
 * bytes on the main thread.
 */
export async function checkPdfPageLimit(bytes: Uint8Array, maxPages: number): Promise<PdfPageCheck> {
  const ceiling = maxPages * PAGE_SCAN_HEADROOM
  const scan = scanPdfPages(bytes, ceiling)
  if (scan === null) return 'unknown'
  if (scan.markers > ceiling) return 'over'
  if (scan.bound <= maxPages) return 'ok'
  if (scan.objects > LOAD_OBJECT_LIMIT) return scan.markers > maxPages ? 'over' : 'unknown'
  const { countPdfPagesSandboxed } = await import('@/lib/pdf-sandbox')
  const counted = await countPdfPagesSandboxed(bytes, maxPages)
  if (!counted.ok) {
    if (counted.reason === 'invalid') return 'unknown'
    return counted.reason === 'busy' ? 'busy' : 'failed'
  }
  if (counted.value === null) return 'unknown'
  return counted.value > maxPages ? 'over' : 'ok'
}
