import { createHash } from 'node:crypto'

/**
 * What a response must keep when routing is switched on (S5, B10a): status,
 * headers and body, with only what changes per request or per server masked.
 * Masked values are replaced, not dropped, so a value that moves still shows.
 */

export type RawResponse = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export type Fingerprint = {
  status: number
  headers: Record<string, string>
  bodyLength: number
  bodySha256: string
}

// Set by the server or by state, not by the request's route. Any other header
// is compared, so a new one that routing adds is a difference.
const IGNORED_HEADERS = new Set([
  'connection',
  'content-length', // the body hash covers it
  'date',
  'etag', // a hash of the body before masking
  'keep-alive',
  'transfer-encoding',
  'x-nextjs-cache', // HIT or STALE, depending on what came before
  'x-nextjs-prerender',
  'x-nextjs-stale-time',
])

const NONCE_ATTRIBUTE = /\bnonce="[^"]*"/g
const NONCE_IN_POLICY = /'nonce-([^']+)'/

function policyNonce(headers: RawResponse['headers']): string | null {
  for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
    const value = headers[name]
    const match = typeof value === 'string' ? NONCE_IN_POLICY.exec(value) : null
    if (match) return match[1]
  }
  return null
}

/** Masks this response's nonce wherever it appears, and the port of the server that sent it. */
function masker(res: RawResponse, port: number): (text: string) => string {
  const nonce = policyNonce(res.headers)
  return (text) => {
    let out = nonce ? text.split(nonce).join('NONCE') : text
    out = out.replace(NONCE_ATTRIBUTE, 'nonce="NONCE"')
    return out.split(`:${port}`).join(':PORT')
  }
}

export function fingerprint(res: RawResponse, port: number): Fingerprint {
  const mask = masker(res, port)
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(res.headers)) {
    if (value === undefined || IGNORED_HEADERS.has(name)) continue
    headers[name] = mask(Array.isArray(value) ? value.join('\n') : value)
  }
  const body = mask(res.body)
  return {
    status: res.status,
    headers,
    bodyLength: body.length,
    bodySha256: createHash('sha256').update(body).digest('hex'),
  }
}

/** What differs between two fingerprints, by name. Values stay out of the log: it is public. */
export function differences(a: Fingerprint, b: Fingerprint): string[] {
  const out: string[] = []
  if (a.status !== b.status) out.push(`status ${a.status} vs ${b.status}`)
  if (a.bodySha256 !== b.bodySha256) out.push(`body (${a.bodyLength} vs ${b.bodyLength} chars)`)
  for (const name of new Set([...Object.keys(a.headers), ...Object.keys(b.headers)])) {
    if (a.headers[name] !== b.headers[name]) out.push(`header ${name}`)
  }
  return out
}
