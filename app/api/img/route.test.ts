import { describe, it, expect } from 'vitest'
import { GET } from './route'

// Guard-path tests (no network): the route must reject anything that isn't a
// Sanity CDN https URL before it ever fetches, so it can't be used as an open
// image proxy. The happy path (real Sanity fetch + composite) is verified
// against a live asset and by lib/watermark/image.test.ts.

function call(url: string) {
  return GET(new Request(url))
}

describe('/api/img guard', () => {
  it('400s when src is missing', async () => {
    expect((await call('https://app.test/api/img')).status).toBe(400)
  })

  it('400s on a non-allowlisted host', async () => {
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('https://evil.example.com/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a non-https src', async () => {
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('http://cdn.sanity.io/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a malformed src', async () => {
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('not-a-url'))
    expect(res.status).toBe(400)
  })
})
