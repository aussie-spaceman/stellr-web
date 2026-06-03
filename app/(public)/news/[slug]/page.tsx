import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'News Article' }

export default function NewsArticlePage({ params }: { params: { slug: string } }) {
  return (
    <div className="section-padding container-max">
      <h1 className="text-4xl font-bold text-brand-navy">{params.slug.replace(/-/g, ' ')}</h1>
      <p className="mt-3 text-brand-grey-dark">News article — coming in step 11.</p>
    </div>
  )
}
