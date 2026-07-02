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
      { source: '/campaigns', destination: '/curriculum', permanent: true },
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
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
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
