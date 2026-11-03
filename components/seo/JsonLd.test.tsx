import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JsonLd } from './JsonLd'
import { GuideFaq } from '@/components/guides/GuideFaq'
import { Faq } from '@/components/lp/sections/Faq'
import type { LandingPageConfig } from '@/content/lp/types'

// S0 content safety: render the server HTML, parse it the way a browser would,
// and prove a hostile string stays inside the one JSON-LD block — no second
// <script> appears, and the block still parses back to the original data.

const XSS = '</script><script>alert(1)</script><!--'

function parse(element: ReactElement) {
  const html = renderToStaticMarkup(element)
  const doc = new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, 'text/html')
  return { html, scripts: [...doc.querySelectorAll('script')] }
}

describe('<JsonLd>', () => {
  it('keeps a script-closing payload inside the block', () => {
    const data = { '@type': 'Article', headline: XSS, author: { name: `${XSS}\u2028` } }
    const { html, scripts } = parse(<JsonLd data={data} />)

    expect(scripts).toHaveLength(1)
    expect(scripts[0].getAttribute('type')).toBe('application/ld+json')
    expect(JSON.parse(scripts[0].textContent ?? '')).toEqual(data)
    expect(html.match(/<script/gi)).toHaveLength(1)
    expect(html.match(/<\/script/gi)).toHaveLength(1)
  })

  it('renders nothing for undefined data', () => {
    expect(renderToStaticMarkup(<JsonLd data={undefined} />)).toBe('')
  })
})

// The two shared FAQ sections were sinks themselves; they now render through
// <JsonLd>, so their question and answer text is escaped with everything else.
describe('FAQ sections', () => {
  const items = [{ q: `Is it safe? ${XSS}`, a: `Yes & no > ${XSS}` }]

  it('GuideFaq', () => {
    const { scripts } = parse(<GuideFaq faqs={items} />)
    expect(scripts).toHaveLength(1)
    const schema = JSON.parse(scripts[0].textContent ?? '')
    expect(schema.mainEntity[0].name).toBe(items[0].q)
  })

  it('landing-page Faq', () => {
    const config = { faq: { eyebrow: 'FAQ', heading: 'Questions', items } } as unknown as LandingPageConfig
    const { scripts } = parse(<Faq config={config} />)
    expect(scripts).toHaveLength(1)
    const schema = JSON.parse(scripts[0].textContent ?? '')
    expect(schema.mainEntity[0].name).toBe(items[0].q)
  })
})
