import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { getAllNewsPosts, urlFor } from '@/lib/sanity'

export const metadata: Metadata = {
  title: 'News & Announcements',
  description: 'The latest news, event results, and STEM updates from Stellr Education.',
}

export const revalidate = 3600

const CATEGORIES = ['All', 'Announcement', 'Event Results', 'STEM News', 'Community'] as const
type Category = typeof CATEGORIES[number]

interface NewsPost {
  _id: string
  title: string
  slug: { current: string }
  publishedAt?: string
  category?: string
  excerpt?: string
  coverImage?: { asset: { _ref: string } }
}

interface PageProps {
  searchParams: Promise<{ category?: string }>
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const categoryColors: Record<string, string> = {
  'Announcement': 'bg-blue-50 text-brand-blue',
  'Event Results': 'bg-green-50 text-green-700',
  'STEM News': 'bg-purple-50 text-purple-700',
  'Community': 'bg-orange-50 text-orange-700',
}

export default async function NewsPage({ searchParams }: PageProps) {
  const { category } = await searchParams
  const allPosts: NewsPost[] = await getAllNewsPosts().catch(() => []) ?? []

  const activeCategory = category ?? 'All'
  const filtered = activeCategory === 'All'
    ? allPosts
    : allPosts.filter((p) => p.category === activeCategory)

  return (
    <>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl sm:text-5xl font-bold mb-3">News &amp; Announcements</h1>
          <p className="text-lg text-gray-300">The latest from Stellr Education.</p>
        </div>
      </section>

      {/* ── Category Filter ───────────────────────────────────────────── */}
      <section className="bg-brand-grey-light border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={cat === 'All' ? '/news' : `/news?category=${encodeURIComponent(cat)}`}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
                activeCategory === cat
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white text-brand-grey-dark border-gray-200 hover:border-brand-blue hover:text-brand-blue'
              }`}
            >
              {cat}
            </Link>
          ))}
        </div>
      </section>

      {/* ── Article Grid ─────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max">
          {filtered.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((post) => (
                <article key={post._id} className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                  {/* Cover image */}
                  <div className="relative h-48 bg-gradient-to-br from-brand-blue-dark to-blue-900">
                    {post.coverImage ? (
                      <Image
                        src={urlFor(post.coverImage).width(600).height(384).url()}
                        alt={post.title}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-blue-300 opacity-30 text-6xl font-bold">S</div>
                    )}
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      {post.category && (
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${categoryColors[post.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {post.category}
                        </span>
                      )}
                      {post.publishedAt && (
                        <span className="text-xs text-brand-grey-mid">{formatDate(post.publishedAt)}</span>
                      )}
                    </div>

                    <h2 className="font-bold text-brand-blue-dark leading-snug mb-2">{post.title}</h2>

                    {post.excerpt && (
                      <p className="text-sm text-brand-grey-dark line-clamp-3 flex-1">{post.excerpt}</p>
                    )}

                    <Link
                      href={`/news/${post.slug.current}`}
                      className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand-blue hover:underline"
                    >
                      Read More <ArrowRight size={14} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="text-center py-24">
              <p className="text-xl text-brand-grey-mid">
                {allPosts.length === 0
                  ? 'No news posts yet — check back soon.'
                  : 'No posts in this category yet.'}
              </p>
              {allPosts.length > 0 && (
                <Link href="/news" className="mt-4 inline-block text-brand-blue hover:underline text-sm">
                  View all posts
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
