/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/login', destination: '/sign-in', permanent: true },
      { source: '/register', destination: '/sign-up', permanent: true },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'img.clerk.com' },
    ],
  },
}

export default nextConfig
