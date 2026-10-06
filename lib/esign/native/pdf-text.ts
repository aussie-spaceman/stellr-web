import { join } from 'node:path'
import { ensureDOMMatrix } from '@/lib/esign/native/dommatrix'

// Reads the text on each page of a PDF, with where it sits. Used to check that
// a template keeps every word of its source document and that rendered values
// land where the field map says. pdf.js runs in-process (its "fake worker"),
// which is fine for the short documents involved.

export interface PageText {
  width: number
  height: number
  items: { str: string; x: number; /** From the top of the page, like the field map. */ y: number }[]
}

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
let pdfjs: Promise<PdfJs> | null = null

// Metrics for the 14 standard PDF fonts (Helvetica and friends), shipped with
// pdf.js and copied into the function bundle by next.config.mjs
// (outputFileTracingIncludes). Found from the project root, as the signing
// fonts are (render.ts): inside the Next server bundle, webpack rewrites
// require.resolve to return a module id, a number, not a path.
const standardFontDataUrl = join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/')

function load(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    // Must precede the import: pdf.js constructs a DOMMatrix at module load.
    ensureDOMMatrix()
    // pdf.js runs its "fake worker" in-process from globalThis.pdfjsWorker when
    // set, and otherwise imports GlobalWorkerOptions.workerSrc, which must be a
    // path string. Handing it the module avoids the path altogether; on
    // production the path was a webpack module id and every template check
    // failed with "Invalid `workerSrc` type" (6 Oct 2026).
    // @ts-expect-error pdfjs-dist ships no types for the worker build
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker ??= worker
    return import('pdfjs-dist/legacy/build/pdf.mjs')
  })()
  return pdfjs
}

export async function extractPages(bytes: Uint8Array | ArrayBuffer): Promise<PageText[]> {
  const { getDocument } = await load()
  // pdf.js takes ownership of the buffer it is given, so it gets a copy.
  const doc = await getDocument({
    data: new Uint8Array(bytes).slice(),
    disableFontFace: true,
    standardFontDataUrl,
  }).promise
  try {
    const pages: PageText[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const { width, height } = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items
        .filter((i): i is typeof i & { str: string; transform: number[] } => 'str' in i && !!i.str.trim())
        .map((i) => ({ str: i.str, x: i.transform[4], y: height - i.transform[5] }))
      pages.push({ width, height, items })
    }
    return pages
  } finally {
    await doc.destroy()
  }
}

/** A page's words in reading order, spacing normalised: for comparing wording. */
export function pageWords(page: PageText): string {
  return page.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim()
}
