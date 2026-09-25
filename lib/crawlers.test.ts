import { describe, expect, it } from 'vitest'
import { AI_CRAWLER_TOKENS, matchCrawler } from './crawlers'

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
