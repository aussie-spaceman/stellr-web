'use client'

import { Children, useEffect, useMemo, useState } from 'react'

export const NEWS_CATEGORIES = ['All', 'Announcement', 'Event Results', 'STEM News', 'Community'] as const

/**
 * The /news category chips and post grid. The server renders every post (so
 * the page can be cached and the posts are in the HTML); the chips hide and
 * show them here and keep the choice in the URL, so `/news?category=…` links
 * still land filtered.
 */
export function NewsBoard({
  categories,
  children,
}: {
  /** Each post's category, in the same order as the children. */
  categories: (string | undefined)[]
  children: React.ReactNode
}) {
  const posts = Children.toArray(children)
  const [active, setActive] = useState<string>('All')

  // A shared or bookmarked filtered link: apply it after hydration.
  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get('category')
    if (fromQuery && (NEWS_CATEGORIES as readonly string[]).includes(fromQuery)) setActive(fromQuery)
  }, [])

  const choose = (cat: string) => {
    setActive(cat)
    window.history.replaceState(
      null,
      '',
      cat === 'All' ? window.location.pathname : `?category=${encodeURIComponent(cat)}`,
    )
  }

  const shown = useMemo(() => categories.map((c) => active === 'All' || c === active), [categories, active])
  const count = shown.filter(Boolean).length

  return (
    <>
      <section className="bg-brand-grey-light border-b border-line px-4 sm:px-6 lg:px-8 py-4">
        <div role="group" aria-label="Category" className="max-w-7xl mx-auto flex flex-wrap gap-2">
          {NEWS_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              aria-pressed={active === cat}
              onClick={() => choose(cat)}
              className={`min-h-11 px-4 rounded-full text-sm font-medium transition-colors border ${
                active === cat
                  ? 'bg-primary-deep text-white border-primary-deep'
                  : 'bg-white text-brand-grey-dark border-line hover:border-primary-deep hover:text-primary-deep'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </section>

      <section className="section-padding">
        <div className="container-max">
          <p className="sr-only" role="status">
            {count} {count === 1 ? 'post' : 'posts'}
          </p>
          {count > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {posts.map((post, i) => (shown[i] ? post : null))}
            </div>
          ) : (
            <div className="text-center py-24">
              <p className="text-xl text-content-muted">
                {posts.length === 0 ? 'No news posts yet — check back soon.' : 'No posts in this category yet.'}
              </p>
              {posts.length > 0 && (
                <button
                  type="button"
                  onClick={() => choose('All')}
                  className="mt-4 min-h-11 text-primary-deep hover:underline text-sm"
                >
                  View all posts
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  )
}
