import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewsBoard } from './NewsBoard'

// /news is a cached page: every post is in the HTML and the category chips
// filter in the browser. A `?category=` link (old bookmarks, shared links) must
// still land filtered.
const POSTS = [
  { title: 'Results are in', category: 'Event Results' },
  { title: 'New season', category: 'Announcement' },
  { title: 'Uncategorised note', category: undefined },
]

function board() {
  return render(
    <NewsBoard categories={POSTS.map((p) => p.category)}>
      {POSTS.map((p) => (
        <article key={p.title}>{p.title}</article>
      ))}
    </NewsBoard>,
  )
}

describe('NewsBoard', () => {
  afterEach(() => window.history.replaceState(null, '', '/'))

  it('shows every post, then filters by chip and records it in the URL', async () => {
    board()
    expect(screen.getAllByRole('article')).toHaveLength(3)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Event Results' }))
    expect(screen.getAllByRole('article').map((a) => a.textContent)).toEqual(['Results are in'])
    expect(screen.getByRole('button', { name: 'Event Results' })).toHaveAttribute('aria-pressed', 'true')
    expect(window.location.search).toBe('?category=Event%20Results')
    expect(screen.getByRole('status')).toHaveTextContent('1 post')
  })

  it('applies a ?category= link after hydration', () => {
    window.history.replaceState(null, '', '/news?category=Announcement')
    board()
    expect(screen.getAllByRole('article').map((a) => a.textContent)).toEqual(['New season'])
  })

  it('ignores an unknown category', () => {
    window.history.replaceState(null, '', '/news?category=Nonsense')
    board()
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('offers a way back from an empty category', async () => {
    board()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Community' }))
    expect(screen.queryAllByRole('article')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'View all posts' }))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(window.location.search).toBe('')
  })
})
