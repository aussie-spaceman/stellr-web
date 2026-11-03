import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_CRAWLER_TOKENS, matchCrawler, recordCrawlerHit } from './crawlers'

// Real user-agent strings as each vendor documents them.
const UA = {
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  chatgptUser: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  claudeSearch: 'Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)',
  perplexity: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
  chrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
}

describe('matchCrawler', () => {
  it('identifies each crawler by its product token', () => {
    expect(matchCrawler(UA.gptbot)).toBe('GPTBot')
    expect(matchCrawler(UA.chatgptUser)).toBe('ChatGPT-User')
    expect(matchCrawler(UA.claudeSearch)).toBe('Claude-SearchBot')
    expect(matchCrawler(UA.perplexity)).toBe('PerplexityBot')
    expect(matchCrawler(UA.googlebot)).toBe('Googlebot')
    expect(matchCrawler(UA.bingbot)).toBe('bingbot')
  })

  it('ignores browsers and missing user agents', () => {
    expect(matchCrawler(UA.chrome)).toBeNull()
    expect(matchCrawler(null)).toBeNull()
  })
})

describe('AI_CRAWLER_TOKENS', () => {
  it('keeps every crawler robots.txt has always named', () => {
    // robots.ts reads this list; dropping one would silently change policy.
    expect(AI_CRAWLER_TOKENS).toEqual(
      expect.arrayContaining([
        'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User', 'Claude-SearchBot',
        'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'CCBot',
        'Bytespider', 'meta-externalagent',
      ])
    )
    expect(AI_CRAWLER_TOKENS).not.toContain('Googlebot')
  })
})

// S0 key migration: this is a raw PostgREST call, not supabase-js, so it builds
// its own headers. A secret key is not a JWT and must not go on Authorization.
describe('recordCrawlerHit', () => {
  const SECRET = 'sb_secret_TESTONLY'
  const LEGACY_SERVICE = 'eyJhbGci.eyJyb2xl.c2VydmljZQ'
  const fetchMock = vi.fn(async () => new Response(null, { status: 201 }))

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SECRET_KEY', undefined)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', undefined)
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    fetchMock.mockClear()
  })

  const headersSent = () => (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>

  it('sends a new secret key on apikey only', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET)
    await recordCrawlerHit('GPTBot', '/events')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(headersSent().apikey).toBe(SECRET)
    expect(headersSent()).not.toHaveProperty('Authorization')
  })

  it('still sends a legacy service_role JWT on both headers', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', LEGACY_SERVICE)
    await recordCrawlerHit('GPTBot', '/events')
    expect(headersSent()).toMatchObject({ apikey: LEGACY_SERVICE, Authorization: `Bearer ${LEGACY_SERVICE}` })
  })

  it('skips the write, without throwing, when the key is missing or mis-slotted', async () => {
    await expect(recordCrawlerHit('GPTBot', '/events')).resolves.toBeUndefined()
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_publishable_TESTONLY')
    await expect(recordCrawlerHit('GPTBot', '/events')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
