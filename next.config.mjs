/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace UI packages ship TS source — let Next transpile them.
  transpilePackages: ['@stellr/web-ui', '@stellr/icons'],
  async redirects() {
    return [
      { source: '/login', destination: '/sign-in', permanent: true },
      { source: '/signup', destination: '/sign-up', permanent: true },
      { source: '/register', destination: '/sign-up', permanent: true },
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
