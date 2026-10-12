import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { RichTextContent } from './RichTextContent'

// deep review MEM-17: the renderer must not emit links with non-web schemes, nor
// images from outside the access-gated media proxy (an external image src is a
// tracking pixel that logs the IP/UA of every member — minors included).

const linkDoc = (href: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href } }] }] }],
})
const imageDoc = (src: string) => ({ type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'x' } }] })

describe('RichTextContent links (MEM-17)', () => {
  it('drops a javascript: link but keeps its text', () => {
    const { container } = render(<RichTextContent doc={linkDoc('javascript:alert(1)')} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('click')
  })

  it('drops a protocol-relative off-site link', () => {
    const { container } = render(<RichTextContent doc={linkDoc('//evil.example/login')} />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('keeps an https link', () => {
    const { container } = render(<RichTextContent doc={linkDoc('https://stellreducation.org/x')} />)
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://stellreducation.org/x')
  })

  it('keeps a same-origin relative link', () => {
    const { container } = render(<RichTextContent doc={linkDoc('/community/general/123')} />)
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/community/general/123')
  })
})

describe('RichTextContent images (MEM-17)', () => {
  it('drops an external image src', () => {
    const { container } = render(<RichTextContent doc={imageDoc('https://evil.example/pixel.png')} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders an image served by the media proxy', () => {
    const src = '/api/community/media/community-media/00000000-0000-4000-8000-000000000001/pic.png'
    const { container } = render(<RichTextContent doc={imageDoc(src)} />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(src)
  })
})
