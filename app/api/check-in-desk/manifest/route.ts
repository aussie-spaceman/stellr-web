import { NextResponse } from 'next/server'
import { tokens } from '@/lib/tokens'

// GET /api/check-in-desk/manifest?slug= — the web app manifest for one event's
// check-in desk, so Add to Home Screen on a desk iPad opens that desk full
// screen. Public on purpose: a browser fetches a manifest without the sign-in
// cookie, and this names nothing but the desk's address. The desk itself still
// needs a staff sign-in.

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/

export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug') ?? ''
  if (!SLUG.test(slug)) return NextResponse.json({ error: 'Unknown event' }, { status: 404 })
  return NextResponse.json(
    {
      name: 'Stellr check-in desk',
      short_name: 'Check-in',
      description: 'The registration desk for a Stellr event.',
      id: `/admin/competitions/${slug}/check-in`,
      start_url: `/admin/competitions/${slug}/check-in`,
      scope: '/admin/competitions/',
      display: 'standalone',
      orientation: 'any',
      background_color: tokens.color.surface,
      theme_color: tokens.color.midnight,
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=86400' } }
  )
}
