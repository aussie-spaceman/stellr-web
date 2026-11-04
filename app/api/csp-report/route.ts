import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import {
  MAX_REPORT_BYTES,
  REPORT_CONTENT_TYPES,
  formatViolation,
  parseCspReports,
} from '@/lib/csp-report'

// Content-Security-Policy violation reports (S1, Report-Only; lib/csp.ts).
// Public on purpose: browsers post here with no session, for any visitor. So
// it reads no cookies, keeps nothing, and only writes one compact line per
// violation to the function log (lib/csp-report.ts strips anything that could
// identify a person). proxy.ts skips this path, so a report costs no proxy run.
//
// Limits: 16 KB per request, 20 violations per request, 30 requests a minute
// per IP (in memory, per instance: a cap on log noise, not a quota).

const LIMIT = { limit: 30, windowMs: 60_000 }

const empty = (status: number, headers?: Record<string, string>) => new Response(null, { status, headers })

/** The body as text, or null once it passes the size cap. */
async function readCapped(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_REPORT_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export async function POST(req: Request) {
  const rl = checkRateLimit(`csp-report:${clientIp(req)}`, LIMIT)
  if (!rl.ok) return empty(429, { 'Retry-After': String(rl.retryAfterSeconds) })

  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!REPORT_CONTENT_TYPES.includes(type)) return empty(415)

  const text = await readCapped(req)
  if (text === null) return empty(413)

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return empty(400)
  }

  for (const v of parseCspReports(body)) console.warn(formatViolation(v))
  return empty(204)
}
