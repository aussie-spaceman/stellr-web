/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace UI packages ship TS source — let Next transpile them.
  transpilePackages: ['@stellr/web-ui', '@stellr/icons'],
  async redirects() {
    return [
      { source: '/login', destination: '/sign-in', permanent: true },
      { source: '/signup', destination: '/sign-up', permanent: true },
      { source: '/register', destination: '/sign-up', permanent: true },
      // 'Activities' was renamed to the canonical object name 'Campaigns'.
      { source: '/activities', destination: '/campaigns', permanent: true },
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
