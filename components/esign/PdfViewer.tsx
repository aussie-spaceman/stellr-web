'use client'

import { useEffect, useRef, useState } from 'react'

// The document, drawn into the page with pdf.js: every phone and browser shows
// it the same way, inside the signing page, instead of depending on a built-in
// PDF viewer (many phones have none, and some block one inside a frame).
// Each page is an image with its page number for screen readers; the text
// version beside it is the accessible equivalent of the wording.
//
// Pages are drawn at the width they're shown at. Turning a phone sideways
// changes that width, so the pages are drawn again (after the turn settles)
// rather than stretched and blurred.

type PdfDoc = {
  numPages: number
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number }
    render: (o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
  }>
  destroy: () => Promise<void>
}

const REDRAW_THRESHOLD_PX = 40
const REDRAW_DELAY_MS = 250

export function PdfViewer({ src, title, signRef }: { src: string; title: string; signRef?: string | null }) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let doc: PdfDoc | null = null
    let drawnWidth = 0
    let drawId = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let observer: ResizeObserver | null = null

    async function draw() {
      const host = pagesRef.current
      if (!host || !doc) return
      const myDraw = ++drawId
      const cssWidth = host.clientWidth || 600
      drawnWidth = cssWidth
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      const canvases: HTMLCanvasElement[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        if (cancelled || myDraw !== drawId) return
        const page = await doc.getPage(n)
        const viewport = page.getViewport({ scale: (cssWidth / page.getViewport({ scale: 1 }).width) * ratio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = '100%'
        canvas.setAttribute('role', 'img')
        canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`)
        canvas.className = 'block bg-white'
        await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise
        canvases.push(canvas)
        // First draw: show pages as they arrive. A redraw swaps them in at the
        // end, so the reader's place doesn't jump while it works.
        if (drawnWidth === cssWidth && !host.dataset.drawn) host.appendChild(canvas)
      }
      if (cancelled || myDraw !== drawId) return
      if (host.dataset.drawn) host.replaceChildren(...canvases)
      host.dataset.drawn = '1'
    }

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        // deep review ES-1: name the recipient this tab is signing for, so the
        // document fetched is this tab's own, not another open tab's.
        const res = await fetch(src, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: signRef ? { 'x-sign-ref': signRef } : undefined,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        doc = (await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise) as unknown as PdfDoc
        if (cancelled) return
        setPageCount(doc.numPages)
        const host = pagesRef.current
        if (!host) return
        host.replaceChildren()
        delete host.dataset.drawn
        await draw()
        if (!cancelled) setState('ready')
        observer = new ResizeObserver(() => {
          const width = host.clientWidth
          if (!width || Math.abs(width - drawnWidth) < REDRAW_THRESHOLD_PX) return
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => void draw(), REDRAW_DELAY_MS)
        })
        observer.observe(host)
      } catch (err) {
        // Leaving the step while pages are still being drawn cancels them: not a failure.
        if (cancelled || (err as { name?: string } | null)?.name === 'RenderingCancelledException') return
        console.error('[sign] document viewer failed:', err)
        setState('error')
      }
    })()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      observer?.disconnect()
      void doc?.destroy()
    }
  }, [src, signRef])

  return (
    <section aria-label={title} className="space-y-2">
      {/* On a phone the pages scroll with the page itself: a box that scrolls
          inside a scrolling page traps the reader's thumb, and in landscape it
          would be a few lines tall. From sm up, the pages sit in a box. */}
      <div
        ref={pagesRef}
        className="space-y-3 rounded-control border border-line bg-surface p-2 sm:max-h-[70svh] sm:overflow-y-auto"
        // Focusable so the pages can be scrolled from the keyboard.
        tabIndex={0}
        role="region"
        aria-label="Document pages"
        aria-busy={state === 'loading'}
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="text-sm text-content-muted" aria-live="polite">
          {state === 'loading' && 'Loading the document…'}
          {state === 'ready' && `${pageCount} page${pageCount === 1 ? '' : 's'}. Scroll to read them all.`}
          {state === 'error' && 'The document could not be shown here.'}
        </p>
        <a
          className="inline-flex min-h-11 items-center rounded-control border-2 border-primary-deep px-4 text-sm font-semibold text-primary-deep"
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open it as a PDF
        </a>
      </div>
    </section>
  )
}
