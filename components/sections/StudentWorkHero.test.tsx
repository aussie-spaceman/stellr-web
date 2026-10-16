import { describe, it, expect, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import { StudentWorkHero } from './StudentWorkHero'

// The slides render straight from their pre-sized WebP copies. A /_next/image
// URL here would mean the optimizer is re-encoding them, which spends the Hobby
// team's monthly Image Optimization quota.
const SLIDES = [
  { src: 'https://media.test/a.png', srcSet: 'https://media.test/a-640.webp 640w, https://media.test/a-1080.webp 1080w', alt: 'Slide A' },
  { src: 'https://media.test/b.png', srcSet: 'https://media.test/b-640.webp 640w, https://media.test/b-720.webp 720w', alt: 'Slide B' },
]

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

describe('StudentWorkHero', () => {
  it('renders each slide from its srcset, lazily, without the image optimizer', () => {
    const { container } = render(<StudentWorkHero images={SLIDES} />)
    const imgs = [...container.querySelectorAll('img')]
    expect(imgs).toHaveLength(2)
    for (const [i, img] of imgs.entries()) {
      expect(img).toHaveAttribute('src', SLIDES[i].src)
      expect(img).toHaveAttribute('srcset', SLIDES[i].srcSet)
      expect(img).toHaveAttribute('sizes', '(min-width: 1024px) 540px, 100vw')
      expect(img).toHaveAttribute('loading', 'lazy')
      expect(img.outerHTML).not.toContain('/_next/image')
    }
  })
})
