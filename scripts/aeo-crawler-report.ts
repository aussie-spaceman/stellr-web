/**
 * Monthly crawler report for the AEO baseline: page requests per bot, and the
 * pages AI crawlers fetched most, from `crawler_hits` (written by proxy.ts).
 *
 *   npm run aeo:crawlers                 # last 30 days, database in .env.local
 *   npm run aeo:crawlers -- --days 7
 *
 * Point it at production by running with the production Supabase URL and
 * service-role key in the environment — never by putting them in .env.local
 * (see docs/ENV-MATRIX.md).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { CRAWLERS } from '../lib/crawlers'

type Hit = { bot: string; path: string }

async function main() {
  const daysArg = process.argv.indexOf('--days')
  const days = daysArg > -1 ? Number(process.argv[daysArg + 1]) : 30
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')

  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const hits: Hit[] = []
  const PAGE = 1000
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(
      `${url}/rest/v1/crawler_hits?select=bot,path&seen_at=gte.${since}&order=id.asc&limit=${PAGE}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    )
    if (!res.ok) throw new Error(`crawler_hits read failed: ${res.status} ${await res.text()}`)
    const page = (await res.json()) as Hit[]
    hits.push(...page)
    if (page.length < PAGE) break
  }

  const host = new URL(url).host.split('.')[0]
  console.log(`Crawler hits, last ${days} days (Supabase project ${host}): ${hits.length} total\n`)

  const byBot = new Map<string, number>()
  for (const h of hits) byBot.set(h.bot, (byBot.get(h.bot) ?? 0) + 1)
  const aiTokens = new Set<string>(CRAWLERS.filter((c) => c.ai).map((c) => c.token))
  console.log('Bot                  Type     Hits')
  for (const [bot, n] of [...byBot].sort((a, b) => b[1] - a[1])) {
    console.log(`${bot.padEnd(20)} ${(aiTokens.has(bot) ? 'AI' : 'search').padEnd(8)} ${n}`)
  }

  const aiPaths = new Map<string, number>()
  for (const h of hits) if (aiTokens.has(h.bot)) aiPaths.set(h.path, (aiPaths.get(h.path) ?? 0) + 1)
  console.log('\nTop pages fetched by AI crawlers')
  for (const [path, n] of [...aiPaths].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`${String(n).padStart(6)}  ${path}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
