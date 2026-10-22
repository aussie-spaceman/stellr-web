// Routes that mount a Jitsi video room: session rooms (VideoRoom,
// CohortLiveRoom), live training lessons (LessonMedia) and the admin course
// builder's RecordSession. Exported for next-config.test.ts.
export const VIDEO_ROUTES = [
  '/community/sessions/:id/room',
  '/community/training/:path*',
  '/admin/academy/training/:path*',
]
const VIDEO_ORIGINS = '"https://8x8.vc" "https://meet.jit.si"'
export const VIDEO_PERMISSIONS_POLICY = `camera=(self ${VIDEO_ORIGINS}), microphone=(self ${VIDEO_ORIGINS}), geolocation=(), payment=(self)`

// The stellr-web-dev Vercel project (same ID as scripts/vercel-ignore-build.sh).
export const DEV_PROJECT_ID = 'prj_Nd2kmpMj3bBuXbSjc6teUdwh9gPO'

/**
 * next/image settings. Vercel counts a transformation each time it generates
 * an image it hasn't cached: one per source, width and format, in each project,
 * until the copy expires. Hobby includes 5,000 a month across both projects,
 * and three quarters of it was gone by 16 Oct 2026. So: one format, few
 * widths, long-lived copies, and only our own sources. Takes the env so
 * next-config-images.test.ts can check each case.
 *
 * @param {Record<string, string | undefined>} [env]
 */
export function imagesConfig(env = process.env) {
  let mediaHost = null
  try {
    mediaHost = new URL(env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').hostname
  } catch {
    // Unset: mediaUrl() serves the local paths below instead.
  }
  const sanityProject = env.NEXT_PUBLIC_SANITY_PROJECT_ID
  const sanityDataset = env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'

  return {
    // The dev project keeps a cache of its own, so every image viewed there was
    // generated a second time. Dev serves the originals; only the team sees it.
    unoptimized: env.VERCEL_PROJECT_ID === DEV_PROJECT_ID,
    // WebP only. AVIF is smaller again, but each format is another copy of
    // every image.
    formats: ['image/webp'],
    // Subsets of Next's defaults, so copies cached before this change still
    // match. Nothing needs more than 1920: the largest sources are the 1400px
    // event and news heroes.
    deviceSizes: [640, 828, 1080, 1200, 1920],
    imageSizes: [64, 128, 256, 384],
    qualities: [75],
    // Keep generated copies for 31 days (Next's default is 4 hours for remote
    // sources). Sanity and /public files change URL when they change; a media
    // file replaced in place needs `vercel cache invalidate --srcimg <url>`.
    minimumCacheTTL: 2678400,
    remotePatterns: [
      // Sanity images normally come through /api/img with the watermark. This
      // covers a direct use, and only for our own project.
      ...(sanityProject
        ? [{ protocol: 'https', hostname: 'cdn.sanity.io', pathname: `/images/${sanityProject}/${sanityDataset}/**` }]
        : []),
      // The media host (lib/media-helpers mediaUrl).
      ...(mediaHost ? [{ protocol: 'https', hostname: mediaHost, pathname: '/**', search: '' }] : []),
    ],
    // First-party paths next/image may load. Only the watermark route takes a
    // query string (`/api/img?src=…`). Any other path fails: `npm run dev`
    // throws, and a production build gets a 400 and shows the alt text. So add
    // a new image folder here.
    localPatterns: [
      { pathname: '/api/img' },
      { pathname: '/images/**', search: '' },
      { pathname: '/team/**', search: '' },
      // mediaUrl() falls back to these when NEXT_PUBLIC_MEDIA_BASE_URL is unset.
      { pathname: '/media/**', search: '' },
      { pathname: '/videos/**', search: '' },
    ],
    // No dangerouslyAllowSVG: without it Next serves .svg sources as they are,
    // which is all an SVG needs. These two stay as a backstop.
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  }
}

// The member app's host, from the variable lib/env reads for APP_HOST. A dev or
// preview deployment has one host, and both URL variables point at it.
const APP_HOST = new URL(process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org').host

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace UI packages ship TS source — let Next transpile them.
  transpilePackages: ['@stellr/web-ui', '@stellr/icons'],
  // deep review TEST-12: the repo's lint (eslint.config.mjs) is deliberately
  // non-blocking and run on its own via `npm run lint`, not during the build.
  // Keep `next build` doing exactly what it did before the lint config existed,
  // so the required `verify` check is unchanged by it.
  eslint: { ignoreDuringBuilds: true },
  // Function Storage is metered on every retained deployment, so what each
  // function traces matters. Keys are route globs (picomatch, `contains`).
  outputFileTracingExcludes: {
    // ffmpeg-static is a devDependency for the local video-watermark scripts,
    // but Vercel installs devDependencies too. If any route ever imports
    // lib/watermark/video.ts, the tracer would ship the ~70 MB Linux binary.
    '*': ['./node_modules/ffmpeg-static/**'],
    // A page whose segment has an opengraph-image sibling is traced with the
    // og runtime and sharp's 15 MB libvips even though the page never renders
    // the card — the card is its own edge route. /api/img, which does use
    // sharp, is not under /lp and keeps it.
    '/lp/**': [
      './node_modules/sharp/**',
      './node_modules/@img/**',
      './node_modules/next/dist/compiled/@vercel/og/**',
    ],
  },
  // lib/event-pdf.ts reads the certificate name face from public/fonts at
  // request time; public/ is not traced into functions on its own.
  outputFileTracingIncludes: {
    // lib/pd-certificate.ts adds Aileron Regular and Norwester for the PD certificate.
    '/api/admin/events/**': ['./public/fonts/Aileron-SemiBold.otf'],
    '/api/credentials/**': ['./public/fonts/Aileron-SemiBold.otf', './public/fonts/Aileron-Regular.otf', './public/fonts/norwester.otf'],
    '/api/admin/pd-certificate/**': ['./public/fonts/Aileron-SemiBold.otf', './public/fonts/Aileron-Regular.otf', './public/fonts/norwester.otf'],
    // Stellr signing stamps names and values in Open Sans (lib/esign/native/render.ts).
    '/api/sign/**': ['./public/fonts/esign/OpenSans-Regular.ttf'],
    // The template editor checks documents with pdf.js on the server
    // (lib/esign/native/pdf-text.ts), which loads its worker and font metrics
    // from node_modules at run time.
    '/api/admin/esign/**': [
      './public/fonts/esign/OpenSans-Regular.ttf',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
    '/api/admin/events/**/docusign-reissue': ['./public/fonts/esign/OpenSans-Regular.ttf'],
    // The DocuSign opt-out read names each checkbox by the text beside it on
    // the signed document, with pdf.js (lib/esign/providers/docusign.ts): on
    // completion (the webhook) and in the docusign-form-data cron.
    '/api/cron/**': [
      './public/fonts/esign/OpenSans-Regular.ttf',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
    '/api/webhooks/docusign': [
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
  },
  serverExternalPackages: ['pdfjs-dist'],
  async headers() {
    // Pages opened from a private link (lib/private-routes.ts). The link is the
    // key, so: never framed, never cached, never indexed, and never passed on
    // as a referrer to another site.
    const privateLink = [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
    ]
    return [
      // Baseline for every response: no clickjacking from other sites, no MIME
      // sniffing, no full URLs sent to other sites, and no powerful browser
      // features nobody here uses.
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
        ],
      },
      // Video rooms embed Jitsi (8x8.vc in production, meet.jit.si as the dev
      // fallback — lib/video-provider.ts). An empty camera/microphone allowlist
      // on the page also denies every frame inside it, so these routes name the
      // video origins. A later rule overrides the same header key, so the strict
      // baseline still applies everywhere else.
      ...VIDEO_ROUTES.map((source) => ({
        source,
        headers: [{ key: 'Permissions-Policy', value: VIDEO_PERMISSIONS_POLICY }],
      })),
      { source: '/sign', headers: privateLink },
      { source: '/sign/:path*', headers: privateLink },
      { source: '/register/:slug/pay/:path*', headers: privateLink },
      { source: '/register/:slug/pay-seat/:path*', headers: privateLink },
      { source: '/register/:slug/join/:path*', headers: privateLink },
      { source: '/api/sign/:path*', headers: privateLink },
      { source: '/privacy/request', headers: privateLink },
      { source: '/privacy/request/:path*', headers: privateLink },
      { source: '/survey/:path*', headers: privateLink },
      { source: '/api/survey/:path*', headers: privateLink },
      { source: '/team-profile/:path*', headers: privateLink },
      { source: '/api/team-profile/:path*', headers: privateLink },
      // Event check-in, reached from the door QR code. The link carries the
      // event's check-in token and attendees (mostly minors) enter a name and
      // date of birth, so it gets the private-link treatment.
      { source: '/check-in', headers: privateLink },
      { source: '/check-in/:path*', headers: privateLink },
      { source: '/api/check-in', headers: privateLink },
      // deep review MP-12 / MPREG-N2: credential pages carry a (possibly minor's)
      // name opened from a private `?k=` family link, and the page is the MP-1
      // private route at runtime. Give it the same HTTP backstop as the other
      // private links — no referrer, no indexing, and crucially `no-store`, so
      // the page and its opengraph-image share-card are never cached public and
      // never persist a name after an unpublish or erasure.
      { source: '/credentials/:path*', headers: privateLink },
      // deep review PUB-13: the scholarship-offer bearer link (token in the
      // path, reveals a usually-minor applicant's name/event and mints a pay
      // link). Same HTTP backstop as the other private links — no referrer, no
      // indexing, never cached — so the token URL is neither forwarded nor
      // persisted. The tracker suppression itself is driven by lib/private-routes.
      { source: '/scholarship/offer/:path*', headers: privateLink },
      // The signing page shows the document in a same-origin frame. No
      // object-src here: on a PDF response it can stop the browser's own viewer.
      {
        source: '/api/sign/document',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
      // One Next app serves both hosts, so every public page (/academy,
      // /curriculum, /competitions, …) also answers 200 on the member app.
      // Canonicals already point at www, but a canonical is a hint; this keeps
      // the app host out of search and AI indexes outright. Headers, not
      // redirects: signed-in members navigate these pages in-app, and bouncing
      // them to www mid-session is a UX change this should not make.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'app.stellreducation.org' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, follow' }],
      },
    ]
  },
  async redirects() {
    return [
      { source: '/login', destination: '/sign-in', permanent: true },
      { source: '/signup', destination: '/sign-up', permanent: true },
      { source: '/register', destination: '/sign-up', permanent: true },
      // The Teacher Stipend was renamed the Teacher Grant Program. The printed
      // one-pager already in teachers' hands says stellreducation.org/stipend,
      // so this URL has to keep working indefinitely.
      { source: '/stipend', destination: '/grant', permanent: true },
      // 'Activities' → 'Campaigns' → now the Curriculum Campaigns page at /curriculum.
      { source: '/activities', destination: '/curriculum', permanent: true },
      // www keeps the legacy marketing redirect; host-scoped so the member portal
      // at app.stellreducation.org (and localhost dev) serves the real /campaigns route.
      {
        source: '/campaigns',
        destination: '/curriculum',
        permanent: false,
        has: [{ type: 'host', value: 'www.stellreducation.org' }],
      },
      // Old "contribute" URL — contributing = volunteering as a mentor.
      { source: '/contribute', destination: '/mentors', permanent: true },
      // The Community nav pillar has no public landing page; on www send it to
      // Membership. Host-scoped so the member portal at app.stellreducation.org
      // (and localhost dev) keeps serving the real /community.
      {
        source: '/community',
        destination: '/membership',
        permanent: false,
        has: [{ type: 'host', value: 'www.stellreducation.org' }],
      },
      // Academy admin consolidated under /admin/academy (coaching/mentoring/training).
      { source: '/admin/community/sessions/:path*', destination: '/admin/academy/coaching/:path*', permanent: false },
      { source: '/admin/community/cohorts/:path*', destination: '/admin/academy/mentoring/:path*', permanent: false },
      { source: '/admin/community/training/:path*', destination: '/admin/academy/training/:path*', permanent: false },
      // Admin IA restructure: Competitions replaces the old Events admin section.
      { source: '/admin/events/:path*', destination: '/admin/competitions/:path*', permanent: false },
      { source: '/admin/events', destination: '/admin/competitions', permanent: false },
      // Campaign LIST rolled into Competitions; deep /admin/campaigns/:slug stays live.
      { source: '/admin/campaigns', destination: '/admin/competitions', permanent: false },
      // Membership Studio tabs consolidated onto /admin/membership?tab=…
      { source: '/admin/membership/rules', destination: '/admin/membership?tab=rules', permanent: false },
      { source: '/admin/membership/discounts', destination: '/admin/membership?tab=discounts', permanent: false },
      { source: '/admin/community/entitlements', destination: '/admin/membership?tab=entitlements', permanent: false },
      // Section roots land on their first page.
      { source: '/admin/community', destination: '/admin/community/spaces', permanent: false },
      { source: '/admin/academy', destination: '/admin/academy/training', permanent: false },
      { source: '/admin/operations', destination: '/admin/activity-log', permanent: false },
      // Volunteers now lives under Members.
      { source: '/admin/volunteers', destination: '/admin/members/volunteers', permanent: false },
      // Access console moved under Members; the query string (?tab=) is forwarded.
      { source: '/admin/access', destination: '/admin/members/access', permanent: false },
      // Gates folded into the Training console (Reminders & escalation tab).
      { source: '/admin/community/gates', destination: '/admin/academy/training?tab=reminders', permanent: false },
    ]
  },
  async rewrites() {
    return {
      // The member app's manifest (app/app.webmanifest), served at the same URL
      // as the www one so the root layout's link needs no host check. Both are
      // static files; beforeFiles so this wins over the www one on the app host.
      beforeFiles: [
        { source: '/manifest.webmanifest', has: [{ type: 'host', value: APP_HOST }], destination: '/app.webmanifest' },
      ],
    }
  },
  images: imagesConfig(),
}

export default nextConfig
