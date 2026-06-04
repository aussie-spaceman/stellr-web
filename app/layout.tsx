import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/react'
import { MarketingPixels } from '@/components/analytics/MarketingPixels'
import '../styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'),
  title: {
    template: '%s | Stellr Education',
    default: 'Stellr Education — Real-World STEM Competitions',
  },
  description:
    'Stellr connects middle and high school students with industry professionals through high-tempo design competitions across the US.',
  openGraph: {
    siteName: 'Stellr Education',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
  },
}

// Organization JSON-LD for root layout
const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Stellr Education',
  url: 'https://www.stellreducation.org',
  logo: 'https://www.stellreducation.org/images/stellr-logo.png',
  contactPoint: {
    '@type': 'ContactPoint',
    email: 'david.shaw@insimeducation.com',
    contactType: 'customer service',
  },
  sameAs: [
    'https://www.linkedin.com/company/stellreducation',
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
      </head>
      <body>
        {children}
        <Analytics />
        <MarketingPixels />
      </body>
    </html>
  )
}
