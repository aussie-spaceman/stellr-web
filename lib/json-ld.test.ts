import { describe, expect, it } from 'vitest'
import { serializeJsonLd } from './json-ld'

// S0 content safety: JSON.stringify left `<` alone, so a Sanity string holding
// "</script>" ended the JSON-LD block and the rest of it ran as page script.

const PAYLOADS = [
  '</script><script>alert(1)</script>',
  '</SCRIPT ><img src=x onerror=alert(1)>',
  '<!--<script>alert(1)//',
  ']]></script><svg onload=alert(1)>',
  'Tom & Jerry > Itchy & Scratchy',
  'line\u2028separator\u2029paragraph',
]

describe('serializeJsonLd', () => {
  it.each(PAYLOADS)('leaves no markup-significant character in %j', (payload) => {
    const out = serializeJsonLd({ '@type': 'Article', headline: payload, about: [{ name: payload }] })!
    expect(out).not.toMatch(/[<>&\u2028\u2029]/)
    expect(out.toLowerCase()).not.toContain('</script')
  })

  it.each(PAYLOADS)('round-trips %j exactly through JSON.parse', (payload) => {
    const data = { '@type': 'FAQPage', mainEntity: [{ name: payload, acceptedAnswer: { text: payload } }] }
    expect(JSON.parse(serializeJsonLd(data)!)).toEqual(data)
  })

  it('escapes keys as well as values', () => {
    expect(serializeJsonLd({ '</script>': 1 })).toBe('{"\\u003c/script\\u003e":1}')
  })

  it('leaves ordinary text byte-for-byte as JSON.stringify writes it', () => {
    const data = [{ '@context': 'https://schema.org', name: 'Stellr — “Design” Challenge', price: 75 }]
    expect(serializeJsonLd(data)).toBe(JSON.stringify(data))
  })

  it('returns null when there is nothing to serialise', () => {
    expect(serializeJsonLd(undefined)).toBeNull()
  })
})
