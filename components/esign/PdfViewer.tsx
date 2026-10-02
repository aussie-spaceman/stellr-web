'use client'

import { useEffect, useRef, useState } from 'react'

// The document, drawn into the page with pdf.js: every phone and browser shows
// it the same way, inside the signing page, instead of depending on a built-in
// PDF viewer (many phones have none, and some block one inside a frame).
// Each page is an image with its page number for screen readers; the text
// version beside it is the accessible equivalent of the wording.

export function PdfViewer({ src, title }: { src: string; title: string }) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageCount, setPageCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    let destroy: (() => Promise<void>) | null = null
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const res = await fetch(src, { credentials: 'same-origin', cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise
        destroy = () => doc.destroy()
        if (cancelled) return
        setPageCount(doc.numPages)

        const host = pagesRef.current
        if (!host) return
        host.replaceChildren()
        const cssWidth = host.clientWidth || 600
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n)
          const viewport = page.getViewport({ scale: (cssWidth / page.getViewport({ scale: 1 }).width) * ratio })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          canvas.style.width = '100%'
          canvas.setAttribute('role', 'img')
          canvas.setAttribute('aria-label', `Page ${n} of ${doc.numPages}`)
          canvas.className = 'block bg-white'
          host.appendChild(canvas)
          await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise
        }
        if (!cancelled) setState('ready')
      } catch (err) {
        console.error('[sign] document viewer failed:', err)
        if (!cancelled) setState('error')
      }
    })()
    return () => {
      cancelled = true
      void destroy?.()
    }
  }, [src])

  return (
    <section aria-label={title} className="space-y-2">
      <div
        ref={pagesRef}
        className="max-h-[75vh] space-y-3 overflow-y-auto rounded-control border border-line bg-surface p-2"
        // Focusable so the pages can be scrolled from the keyboard.
        tabIndex={0}
        role="region"
        aria-label="Document pages"
        aria-busy={state === 'loading'}
      />
      <p className="text-sm text-content-muted" aria-live="polite">
        {state === 'loading' && 'Loading the document…'}
        {state === 'ready' && `${pageCount} page${pageCount === 1 ? '' : 's'}. Scroll to read them all.`}
        {state === 'error' && 'The document could not be shown here.'}
        {' '}
        <a className="text-primary-deep underline" href={src} target="_blank" rel="noopener noreferrer">Open it as a PDF</a>
      </p>
    </section>
  )
}
