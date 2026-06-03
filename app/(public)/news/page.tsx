import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'News & Announcements',
  description: 'The latest from Stellr Education.',
}

export default function NewsPage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">News & Announcements</h1>
      <p className="mt-3 text-brand-grey-dark">News listing page — coming in step 11.</p>
    </div>
  )
}
