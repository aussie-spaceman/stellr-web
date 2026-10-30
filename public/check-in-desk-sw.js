// Check-in desk offline copy (Oct 2026).
//
// Registered by the desk console (components/admin/CheckInLive.tsx) in desk
// mode, scoped to /admin/competitions/. It keeps exactly three things so a desk
// iPad can reload its page with no connection:
//   - the desk page itself (/admin/competitions/<slug>/check-in): network
//     first, the saved copy only when the network fails;
//   - the page's script and style files (/_next/static/, content-hashed, so a
//     saved copy never goes stale);
//   - the scanner's WebAssembly reader (/vendor/zxing_reader.wasm).
// Everything else, the API included, goes to the network untouched. The list of
// arrivals and any taps waiting to send are kept by the page in localStorage
// (lib/check-in-desk.ts), not here.

const CACHE = 'stellr-check-in-desk-v1'
const DESK_PAGE = /^\/admin\/competitions\/[^/]+\/check-in\/?$/
const SCANNER = '/vendor/zxing_reader.wasm'

const isStatic = (url) => url.pathname.startsWith('/_next/static/') || url.pathname === SCANNER

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('stellr-check-in-desk-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })()
  )
})

// The page lists what it loaded. Its first load ran before this worker was in
// control, so nothing was saved then: save it now, refresh the page copy, and
// drop static files the current page no longer uses.
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'warm' || typeof data.page !== 'string') return
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      const assets = (Array.isArray(data.assets) ? data.assets : [])
        .map((u) => new URL(u, self.location.origin))
        .filter((u) => u.origin === self.location.origin && isStatic(u))
      await Promise.all(
        assets.map(async (u) => {
          if (await cache.match(u.href)) return
          await cache.add(u.href).catch(() => {})
        })
      )
      if (DESK_PAGE.test(data.page)) {
        try {
          const res = await fetch(data.page, { credentials: 'same-origin', cache: 'no-store' })
          if (res.ok && !res.redirected) await cache.put(data.page, res)
        } catch {
          /* offline: keep the copy we have */
        }
      }
      const keep = new Set(assets.map((u) => u.href))
      for (const req of await cache.keys()) {
        const u = new URL(req.url)
        if (u.pathname.startsWith('/_next/static/') && !keep.has(u.href)) await cache.delete(req)
      }
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate' && DESK_PAGE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          // A redirect is a sign-in page, not the desk: never save it.
          if (res.ok && !res.redirected) {
            const cache = await caches.open(CACHE)
            await cache.put(url.pathname, res.clone())
          }
          return res
        } catch {
          return (await caches.match(url.pathname)) || Response.error()
        }
      })()
    )
    return
  }

  if (isStatic(url)) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(req, res.clone())
        }
        return res
      })()
    )
  }
})
