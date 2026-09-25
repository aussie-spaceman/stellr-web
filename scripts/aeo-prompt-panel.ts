/**
 * Monthly AEO prompt panel: asks each AI assistant the fixed teacher questions
 * in content/aeo/prompt-panel.ts, with web search on, and records whether
 * Stellr is mentioned, whether stellreducation.org is cited, which other
 * programs appear, and every cited domain.
 *
 *   npm run aeo:panel                 # every assistant with a key set
 *   npm run aeo:panel -- --only claude,perplexity
 *   npm run aeo:panel -- --limit 3    # smoke test: first 3 prompts
 *
 * Keys (any subset; an assistant without one is skipped and says so):
 *   ANTHROPIC_API_KEY   Claude, with the web search tool
 *   OPENAI_API_KEY      ChatGPT, Responses API with web_search
 *   PERPLEXITY_API_KEY  Perplexity Sonar
 *   GEMINI_API_KEY      Gemini, grounded with Google Search
 * Model overrides: AEO_OPENAI_MODEL, AEO_PERPLEXITY_MODEL, AEO_GEMINI_MODEL.
 *
 * Writes .aeo-panel/<date>.csv (one row per prompt × assistant) and prints a
 * summary. The API answers approximate, not reproduce, what a consumer sees in
 * each app — the trend across months is the signal, not any single answer.
 *
 * Costs real money: roughly 20 prompts × 4 assistants per run, each with web
 * search. Run monthly, not in CI.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { mkdirSync, writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { PROMPT_PANEL, TRACKED_PROGRAMS } from '../content/aeo/prompt-panel'

type Answer = { text: string; citations: string[] }
type Assistant = { id: string; key: string; ask: (prompt: string) => Promise<Answer> }

const OWN_DOMAIN = 'stellreducation.org'
const MENTION = /\bstellr\b/i

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ── Assistants ──────────────────────────────────────────────────────────────

async function askClaude(prompt: string): Promise<Answer> {
  const client = new Anthropic()
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }]
  const text: string[] = []
  const citations: string[] = []
  // Web search can pause a long turn; resume it by sending the content back.
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    })
    for (const block of res.content) {
      if (block.type === 'text') {
        text.push(block.text)
        for (const c of block.citations ?? []) if ('url' in c && c.url) citations.push(c.url)
      }
    }
    if (res.stop_reason === 'refusal') text.push('[refused]')
    if (res.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: res.content })
  }
  return { text: text.join(''), citations }
}

async function askOpenAI(prompt: string): Promise<Answer> {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AEO_OPENAI_MODEL ?? 'gpt-5',
      tools: [{ type: 'web_search' }],
      input: prompt,
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    output?: { type: string; content?: { type: string; text?: string; annotations?: { type: string; url?: string }[] }[] }[]
  }
  const text: string[] = []
  const citations: string[] = []
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue
    for (const part of item.content ?? []) {
      if (part.type !== 'output_text') continue
      text.push(part.text ?? '')
      for (const a of part.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.push(a.url)
    }
  }
  return { text: text.join(''), citations }
}

async function askPerplexity(prompt: string): Promise<Answer> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.AEO_PERPLEXITY_MODEL ?? 'sonar',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    citations?: string[]
    search_results?: { url: string }[]
  }
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    citations: body.search_results?.map((r) => r.url) ?? body.citations ?? [],
  }
}

async function askGemini(prompt: string): Promise<Answer> {
  const model = process.env.AEO_GEMINI_MODEL ?? 'gemini-2.5-flash'
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string }[] }
      groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] }
    }[]
  }
  const c = body.candidates?.[0]
  return {
    text: (c?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
    // Grounding URIs are Google redirect links; the title carries the source
    // domain, so it is what gets recorded.
    citations: (c?.groundingMetadata?.groundingChunks ?? [])
      .map((g) => g.web?.title ?? g.web?.uri ?? '')
      .filter(Boolean),
  }
}

const ASSISTANTS: Assistant[] = [
  { id: 'claude', key: 'ANTHROPIC_API_KEY', ask: askClaude },
  { id: 'chatgpt', key: 'OPENAI_API_KEY', ask: askOpenAI },
  { id: 'perplexity', key: 'PERPLEXITY_API_KEY', ask: askPerplexity },
  { id: 'gemini', key: 'GEMINI_API_KEY', ask: askGemini },
]

// ── Run ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

function csvCell(value: string | number | boolean): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const only = arg('--only')?.split(',')
  const limit = Number(arg('--limit') ?? Infinity)
  const prompts = PROMPT_PANEL.filter((p) => !p.retired).slice(0, limit)

  const assistants = ASSISTANTS.filter((a) => !only || only.includes(a.id))
  const ready = assistants.filter((a) => process.env[a.key])
  for (const a of assistants) if (!process.env[a.key]) console.log(`skip ${a.id}: ${a.key} not set`)
  if (ready.length === 0) throw new Error('No assistant has an API key set — nothing to run.')

  const date = new Date().toISOString().slice(0, 10)
  const header = ['date', 'assistant', 'prompt_id', 'kind', 'prompt', 'mentions_stellr', 'cites_stellr', 'programs_mentioned', 'cited_domains', 'answer']
  const rows: string[] = [header.join(',')]
  const tally = new Map<string, { asked: number; mentioned: number; cited: number; categoryAsked: number; categoryMentioned: number }>()

  for (const a of ready) {
    const t = { asked: 0, mentioned: 0, cited: 0, categoryAsked: 0, categoryMentioned: 0 }
    tally.set(a.id, t)
    for (const p of prompts) {
      let answer: Answer
      try {
        answer = await a.ask(p.text)
      } catch (err) {
        console.error(`${a.id} ${p.id} failed: ${err instanceof Error ? err.message : err}`)
        continue
      }
      const domains = [...new Set(answer.citations.map(domainOf))]
      const mentions = MENTION.test(answer.text)
      const cites = domains.some((d) => d.endsWith(OWN_DOMAIN))
      const programs = TRACKED_PROGRAMS.filter((prog) => prog.pattern.test(answer.text)).map((prog) => prog.name)
      t.asked++
      if (mentions) t.mentioned++
      if (cites) t.cited++
      if (p.kind === 'category') {
        t.categoryAsked++
        if (mentions) t.categoryMentioned++
      }
      rows.push(
        [date, a.id, p.id, p.kind, p.text, mentions, cites, programs.join('; '), domains.join('; '), answer.text]
          .map(csvCell)
          .join(',')
      )
      console.log(`${a.id.padEnd(10)} ${p.id}  mention=${mentions ? 'Y' : '-'} cite=${cites ? 'Y' : '-'}`)
    }
  }

  mkdirSync('.aeo-panel', { recursive: true })
  const out = `.aeo-panel/${date}.csv`
  writeFileSync(out, rows.join('\n') + '\n')

  console.log(`\nWrote ${out}\n`)
  console.log('Assistant   Unprompted mention (category)   Any mention   Cites stellreducation.org')
  for (const [id, t] of tally) {
    console.log(
      `${id.padEnd(11)} ${`${t.categoryMentioned}/${t.categoryAsked}`.padEnd(31)} ${`${t.mentioned}/${t.asked}`.padEnd(13)} ${t.cited}/${t.asked}`
    )
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
