import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { PortableText } from 'next-sanity'
import { getNewsPostBySlug, getRelatedNewsPosts, urlFor } from '@/lib/sanity'
import { SubscribeForm } from '@/components/forms/SubscribeForm'

export const revalidate = 3600

interface PageProps {
  params: { slug: string }
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const post = await getNewsPostBySlug(params.slug).catch(() => null)
  if (!post) return { title: 'Article Not Found' }
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: post.coverImage
      ? { images: [{ url: urlFor(post.coverImage).width(1200).height(630).url() }] }
      : undefined,
  }
}

export default async function NewsArticlePage({ params }: PageProps) {
  const post = await getNewsPostBySlug(params.slug).catch(() => null)
  if (!post) notFound()

  const related = post.category
    ? await getRelatedNewsPosts(post.category, post._id).catch(() => []) ?? []
    : []

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-brand-navy text-white">
        {post.coverImage && (
          <div className="relative h-64 sm:h-80">
            <Image
              src={urlFor(post.coverImage).width(1400).height(560).url()}
              alt={post.title}
              fill
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
              <span className={`text-xs font-semibold px-3 py-1 rounded-full ${categoryColors[post.category] ?? 'bg-white/10 text-gray-200'}`}>
                {post.category}
              </span>
            )}
            {post.publishedAt && (
              <span className="text-sm text-gray-400">{formatDate(post.publishedAt)}</span>
            )}
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold leading-tight">{post.title}</h1>
          {post.excerpt && (
            <p className="mt-4 text-lg text-gray-300">{post.excerpt}</p>
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
            <h2 className="text-2xl font-bold text-brand-navy mb-8">Related Articles</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {related.map((rel: { _id: string; title: string; slug: { current: string }; publishedAt?: string; category?: string; excerpt?: string; coverImage?: { asset: { _ref: string } } }) => (
                <article key={rel._id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="relative h-40 bg-gradient-to-br from-brand-navy to-blue-900">
                    {rel.coverImage && (
                      <Image
                        src={urlFor(rel.coverImage).width(400).height(240).url()}
                        alt={rel.title}
                        fill
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="p-4">
                    {rel.publishedAt && (
                      <p className="text-xs text-brand-grey-mid mb-1">{formatDate(rel.publishedAt)}</p>
                    )}
                    <h3 className="font-bold text-brand-navy text-sm leading-snug mb-2">{rel.title}</h3>
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
          <h2 className="text-2xl font-bold text-brand-navy mb-2">Stay in the Loop</h2>
          <p className="text-brand-grey-dark mb-6">
            Get Stellr news, competition dates, and STEM resources in your inbox.
          </p>
          <SubscribeForm />
        </div>
      </section>
    </>
  )
}
