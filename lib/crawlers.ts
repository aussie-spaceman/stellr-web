/**
 * Search and AI crawlers, by the product token in their user agent.
 *
 * Two uses: robots.ts names the AI ones explicitly, and proxy.ts counts page
 * requests from all of them into `crawler_hits` for the AEO baseline. One list,
 * so a crawler we welcome is always a crawler we measure.
 *
 * `robotsOnly` tokens are robots.txt control tokens that never appear in a user
 * agent (Google-Extended rides on Googlebot), so there is nothing to count.
 */
export const CRAWLERS = [
  // OpenAI
  { token: 'GPTBot', ai: true },
  { token: 'OAI-SearchBot', ai: true },
  { token: 'ChatGPT-User', ai: true },
  // Anthropic
  { token: 'ClaudeBot', ai: true },
  { token: 'Claude-User', ai: true },
  { token: 'Claude-SearchBot', ai: true },
  // Perplexity
  { token: 'PerplexityBot', ai: true },
  { token: 'Perplexity-User', ai: true },
  // Training / other AI
  { token: 'Google-Extended', ai: true, robotsOnly: true },
  { token: 'Applebot-Extended', ai: true, robotsOnly: true },
  { token: 'CCBot', ai: true },
  { token: 'Bytespider', ai: true },
  { token: 'meta-externalagent', ai: true },
  // Classic search — counted for context (AI Overviews and Copilot draw on
  // these indexes) but not named in robots.txt, where `*` already covers them.
  { token: 'Googlebot', ai: false },
  { token: 'bingbot', ai: false },
  { token: 'Applebot', ai: false },
] as const

export const AI_CRAWLER_TOKENS: string[] = CRAWLERS.filter((c) => c.ai).map((c) => c.token)

// Longest first, so "Applebot-Extended" would win over "Applebot" and
// "Claude-SearchBot" is not mistaken for a shorter token it contains.
const MATCHABLE = CRAWLERS.filter((c) => !('robotsOnly' in c))
  .map((c) => c.token)
  .sort((a, b) => b.length - a.length)

/** The crawler a user agent belongs to, or null for everyone else. */
export function matchCrawler(userAgent: string | null): string | null {
  if (!userAgent) return null
  const ua = userAgent.toLowerCase()
  return MATCHABLE.find((token) => ua.includes(token.toLowerCase())) ?? null
}

/**
 * Record one crawler page request. Straight to PostgREST rather than through
 * supabase-js, to keep the proxy bundle small; best-effort by design — a failed
 * write must never affect the response the crawler gets.
 */
export async function recordCrawlerHit(bot: string, path: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return
  try {
    await fetch(`${url}/rest/v1/crawler_hits`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ bot, path: path.slice(0, 500) }),
    })
  } catch {
    // Measurement only.
  }
}
