import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { PortableText } from 'next-sanity'
import { getNewsPostBySlug, getRelatedNewsPosts, urlFor, wmSrc } from '@/lib/sanity'
import { formatDate } from '@/lib/utils'
import { categoryColors } from '@/lib/news-utils'
import { buildArticleJsonLd } from '@/lib/structured-data'
import { SubscribeForm } from '@/components/forms/SubscribeForm'

export const revalidate = 3600

// No paths are built ahead (no build-time Sanity or Stripe calls): each page is
// rendered on its first visit and then served from the cache, refreshed on the
// window above or at once by a Sanity publish (/api/webhooks/sanity). Without
// this the page renders on every request.
export function generateStaticParams(): { slug: string }[] {
  return []
}

interface PageProps {
  params: Promise<{ slug: string }>
}


export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  // deep review PUB-9: let a Sanity fetch error propagate; only a genuine miss
  // (null) is "Article Not Found". The page body throws to the error boundary too.
  const post = await getNewsPostBySlug(slug)
  if (!post) return { title: 'Article Not Found' }
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: `/news/${slug}` },
    openGraph: {
      type: 'article',
      publishedTime: post.publishedAt,
      modifiedTime: post._updatedAt ?? post.publishedAt,
      authors: post.author ? [post.author] : undefined,
      images: post.coverImage
        ? [{ url: urlFor(post.coverImage).width(1200).height(630).url() }]
        : undefined,
    },
  }
}

export default async function NewsArticlePage({ params }: PageProps) {
  const { slug } = await params
  // deep review PUB-9: distinguish a Sanity outage (throw → error boundary /
  // retryable 500) from a genuine miss (null → 404). Swallowing to null here
  // de-indexed live news URLs when Sanity was merely unreachable.
  let post
  try {
    post = await getNewsPostBySlug(slug)
  } catch (err) {
    console.error('[news] sanity fetch failed', err)
    throw err
  }
  if (!post) notFound()

  // Related posts are supplementary — a failure to load them must not take down
  // the whole article, so this one stays best-effort (empty list on error).
  const related = post.category
    ? await getRelatedNewsPosts(post.category, post._id).catch(() => []) ?? []
    : []

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildArticleJsonLd(post, slug)) }}
      />
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-brand-blue-dark text-white">
        {post.coverImage && (
          <div className="relative h-64 sm:h-80">
            <Image
              src={wmSrc(urlFor(post.coverImage).width(1400).height(560).url())}
              alt={post.title}
              fill
              sizes="100vw"
              className="object-cover opacity-40"
              priority
            />
          </div>
        )}
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Link href="/news" className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-white mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to News
          </Link>
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {post.category && (
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${categoryColors[post.category] ?? 'bg-white/10 text-hero-lead'}`}>
                {post.category}
              </span>
            )}
            {post.publishedAt && (
              <span className="text-sm text-hero-lead">{formatDate(post.publishedAt)}</span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight">{post.title}</h1>
          {post.excerpt && (
            <p className="mt-4 text-lg text-hero-lead">{post.excerpt}</p>
          )}
        </div>
      </section>

      {/* ── Article Body ─────────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          {post.body ? (
            <div className="prose prose-slate prose-lg max-w-none">
              <PortableText value={post.body} />
            </div>
          ) : (
            <p className="text-brand-grey-dark italic">Article content coming soon.</p>
          )}
        </div>
      </section>

      {/* ── Related Articles ─────────────────────────────────────────── */}
      {related.length > 0 && (
        <section className="section-padding bg-brand-grey-light">
          <div className="container-max">
            <h2 className="text-2xl font-bold text-brand-blue-dark mb-8">Related Articles</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {related.map((rel: { _id: string; title: string; slug: { current: string }; publishedAt?: string; category?: string; excerpt?: string; coverImage?: { asset: { _ref: string } } }) => (
                <article key={rel._id} className="bg-white rounded-xl border border-line-light shadow-sm overflow-hidden">
                  <div className="relative h-40 bg-gradient-to-br from-brand-blue-dark to-blue-900">
                    {rel.coverImage && (
                      <Image
                        src={wmSrc(urlFor(rel.coverImage).width(400).height(240).url())}
                        alt={rel.title}
                        fill
                        sizes="(min-width: 640px) 33vw, 100vw"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    {rel.publishedAt && (
                      <p className="text-xs text-content-muted mb-1">{formatDate(rel.publishedAt)}</p>
                    )}
                    <h3 className="font-bold text-brand-blue-dark text-sm leading-snug mb-2">{rel.title}</h3>
                    <Link
                      href={`/news/${rel.slug.current}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand-blue hover:underline"
                    >
                      Read More <ArrowRight size={12} />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Subscribe Strip ───────────────────────────────────────────── */}
      <section className="section-padding">
        <div className="container-max max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-brand-blue-dark mb-2">Stay in the Loop</h2>
          <p className="text-brand-grey-dark mb-6">
            Get Stellr news, competition dates, and STEM resources in your inbox.
          </p>
          <SubscribeForm />
        </div>
      </section>
    </>
  )
}
