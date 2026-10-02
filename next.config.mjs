/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace UI packages ship TS source — let Next transpile them.
  transpilePackages: ['@stellr/web-ui', '@stellr/icons'],
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
    '/api/admin/events/**': ['./public/fonts/Aileron-SemiBold.otf'],
    '/api/credentials/**': ['./public/fonts/Aileron-SemiBold.otf'],
    // Stellr signing stamps names and values in Open Sans (lib/esign/native/render.ts).
    '/api/sign/**': ['./public/fonts/esign/OpenSans-Regular.ttf'],
    '/api/admin/esign/**': ['./public/fonts/esign/OpenSans-Regular.ttf'],
    '/api/admin/events/**/docusign-reissue': ['./public/fonts/esign/OpenSans-Regular.ttf'],
    '/api/cron/**': ['./public/fonts/esign/OpenSans-Regular.ttf'],
  },
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
      { source: '/sign', headers: privateLink },
      { source: '/sign/:path*', headers: privateLink },
      { source: '/register/:slug/pay/:path*', headers: privateLink },
      { source: '/register/:slug/join/:path*', headers: privateLink },
      { source: '/api/sign/:path*', headers: privateLink },
      // The signing page shows the document in a same-origin frame.
      {
        source: '/api/sign/document',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'" },
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
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
    // Next's default local pattern is `{ pathname: '/**', search: '' }`, which
    // forbids query strings on local images. Our watermark serve-route emits
    // `/api/img?src=…`, so allow any query on first-party local paths (omitting
    // `search` permits any query string). Without this, next/image throws
    // "using a query string which is not configured" and 500s the page.
    localPatterns: [{ pathname: '/**' }],
    // Allow the brand SVGs in /public to be served through next/image. Without
    // this the optimizer returns 400 "image type is not allowed" and every
    // <Image src="*.svg"> (logo mark, wordmark) renders blank. The CSP + sandbox
    // neutralise any script in an SVG; all our SVGs are first-party assets.
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
}

export default nextConfig
