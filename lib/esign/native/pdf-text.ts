import { createRequire } from 'node:module'
import { dirname } from 'node:path'

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
let standardFontDataUrl = ''

function load(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    const require = createRequire(import.meta.url)
    m.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    // Metrics for the 14 standard PDF fonts (Helvetica and friends), shipped with pdf.js.
    standardFontDataUrl = `${dirname(require.resolve('pdfjs-dist/package.json'))}/standard_fonts/`
    return m
  })
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
