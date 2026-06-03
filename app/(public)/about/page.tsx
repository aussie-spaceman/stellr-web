import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'About Stellr',
  description: 'We connect students to the future they\'re studying for.',
}

export default function AboutPage() {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">About Stellr</h1>
      <p className="mt-3 text-brand-grey-dark">About + team page — coming in step 10.</p>
    </div>
  )
}
