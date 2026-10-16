import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { VideoTestimonial } from './VideoTestimonial'

// The poster renders straight from its pre-sized WebP copies. A /_next/image
// URL here would mean the optimizer is re-encoding it, which spends the Hobby
// team's monthly Image Optimization quota.
describe('VideoTestimonial', () => {
  it('shows the poster from its srcset, lazily, without the image optimizer', () => {
    const srcSet = 'https://media.test/v.poster-640.webp 640w, https://media.test/v.poster-1280.webp 1280w'
    const { container } = render(
      <VideoTestimonial
        src="https://media.test/v.mp4"
        poster="https://media.test/v.poster.jpg"
        posterSrcSet={srcSet}
        captionsSrc="https://media.test/v.en.vtt"
        title="A testimonial"
      />,
    )
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://media.test/v.poster.jpg')
    expect(img).toHaveAttribute('srcset', srcSet)
    expect(img).toHaveAttribute('sizes', '(min-width: 1024px) 540px, 100vw')
    expect(img).toHaveAttribute('loading', 'lazy')
    expect(img?.outerHTML).not.toContain('/_next/image')
  })
})
