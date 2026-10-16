import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { getAllNewsPosts, urlFor, wmSrc } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import { categoryColors } from '@/lib/news-utils'
import { NewsBoard } from '@/components/sections/NewsBoard'

export const metadata: Metadata = {
  alternates: { canonical: '/news' },
  title: 'News & Announcements',
  description: 'The latest news, event results, and STEM updates from Stellr Education.',
}

// Static, refreshed hourly. The category chips filter in the browser
// (NewsBoard), so nothing here reads the request.
export const revalidate = 3600

interface NewsPost {
  _id: string
  title: string
  slug: { current: string }
  publishedAt?: string
  category?: string
  excerpt?: string
  coverImage?: { asset: { _ref: string } }
}

export default async function NewsPage() {
  const allPosts: NewsPost[] = await getAllNewsPosts().catch(() => []) ?? []

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3">News &amp; Announcements</h1>
          <p className="text-lg text-hero-lead">The latest from Stellr Education.</p>
        </div>
      </section>

      {/* ── Category Filter + Article Grid ───────────────────────────── */}
      <NewsBoard categories={allPosts.map((p) => p.category)}>
        {allPosts.map((post) => (
          <article key={post._id} className="bg-white rounded-xl border border-line-light shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
            {/* Cover image */}
            <div className="relative h-48 bg-gradient-to-br from-brand-blue-dark to-blue-900">
              {post.coverImage ? (
                <Image
                  src={wmSrc(urlFor(post.coverImage).width(600).height(384).url())}
                  alt={post.title}
                  fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-blue-300 opacity-30 text-6xl font-bold">S</div>
              )}
            </div>

            <div className="p-5 flex flex-col flex-1">
              <div className="flex items-center gap-3 mb-3">
                {post.category && (
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${categoryColors[post.category] ?? 'bg-surface text-content-body'}`}>
                    {post.category}
                  </span>
                )}
                {post.publishedAt && (
                  <span className="text-xs text-content-muted">{formatDate(post.publishedAt)}</span>
                )}
              </div>

              <h2 className="font-bold text-brand-blue-dark leading-snug mb-2">{post.title}</h2>

              {post.excerpt && (
                <p className="text-sm text-brand-grey-dark line-clamp-3 flex-1">{post.excerpt}</p>
              )}

              <Link
                href={`/news/${post.slug.current}`}
                className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
              >
                Read More <ArrowRight size={14} />
              </Link>
            </div>
          </article>
        ))}
      </NewsBoard>
    </>
  )
}
