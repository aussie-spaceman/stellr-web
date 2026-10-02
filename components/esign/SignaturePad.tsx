'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@stellr/web-ui'

// A pad to draw a signature with a finger, pen or mouse. What leaves the page
// is the finished picture only (a trimmed PNG): no stroke timing, pressure or
// path, which some signing products collect and Stellr does not. Typing your
// name remains the default, and the only way for anyone who cannot draw.

const CSS_HEIGHT = 160
const INK = '#0f172a'

export function SignaturePad({ onChange, describedBy }: { onChange: (png: string | null) => void; describedBy?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const box = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null)
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(canvas.clientWidth * ratio)
    canvas.height = Math.floor(CSS_HEIGHT * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = INK
  }, [])

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const grow = (p: { x: number; y: number }) => {
    const b = box.current
    box.current = b
      ? { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = point(e)
    grow(last.current)
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return
    const ctx = e.currentTarget.getContext('2d')
    if (!ctx) return
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    grow(p)
  }

  function end() {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    const canvas = canvasRef.current
    const b = box.current
    if (!canvas || !b) return
    // Only a real mark counts: a tap is not a signature.
    if (b.maxX - b.minX < 12 && b.maxY - b.minY < 12) return
    setEmpty(false)
    onChange(trimmed(canvas, b))
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    }
    box.current = null
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={empty ? 'Signature pad, empty' : 'Signature pad, with your drawn signature'}
        aria-describedby={describedBy}
        className="block w-full touch-none rounded-control border border-line bg-white"
        style={{ height: CSS_HEIGHT }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <Button type="button" variant="secondaryStrong" onClick={clear} disabled={empty}>Clear</Button>
    </div>
  )
}

/** The drawn area plus a margin, at most 600 px wide, as a PNG data URL. */
function trimmed(canvas: HTMLCanvasElement, b: { minX: number; minY: number; maxX: number; maxY: number }): string {
  const ratio = canvas.width / canvas.clientWidth
  const pad = 8
  const sx = Math.max(0, (b.minX - pad) * ratio)
  const sy = Math.max(0, (b.minY - pad) * ratio)
  const sw = Math.min(canvas.width - sx, (b.maxX - b.minX + pad * 2) * ratio)
  const sh = Math.min(canvas.height - sy, (b.maxY - b.minY + pad * 2) * ratio)
  const scale = Math.min(1, 600 / sw)
  const out = document.createElement('canvas')
  out.width = Math.max(20, Math.round(sw * scale))
  out.height = Math.max(10, Math.round(sh * scale))
  out.getContext('2d')?.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}
