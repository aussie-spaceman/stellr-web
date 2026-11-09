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
export const IGNORED_HEADERS = new Set([
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
export function masker(res: RawResponse, port: number): (text: string) => string {
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

/**
 * Where a value the request forged came back, by name. Read from the raw answer: a
 * fingerprint masks every nonce attribute, whatever its value, so it can't see this.
 */
export function echoedIn(res: RawResponse, value: string): string[] {
  const out = res.body.includes(value) ? ['body'] : []
  for (const [name, header] of Object.entries(res.headers)) {
    if (header !== undefined && (Array.isArray(header) ? header.join('\n') : header).includes(value)) out.push(`header ${name}`)
  }
  return out
}

const RELATIVE_BASE = 'http://relative.invalid'
const REDIRECT_PARAM = 'redirect_url'

/**
 * What a forged host moved in an absolute sign-in redirect, by name. The host may be the
 * plain answer's or exactly the forged one, since the redirect is built from the forwarded
 * host the platform sets. Nothing else may move: the sign-in path, its query, and the path
 * and query of the address it sends you back to.
 */
export function redirectMoved(plainLocation: unknown, forgedLocation: unknown, forgedHost: string): string[] {
  const plain = new URL(String(plainLocation), RELATIVE_BASE)
  const forged = new URL(String(forgedLocation), RELATIVE_BASE)
  const out: string[] = []
  const hostOk = (url: URL, against: URL) => url.hostname === against.hostname || url.hostname === forgedHost

  if (!hostOk(forged, plain)) out.push('location host')
  if (forged.pathname !== plain.pathname) out.push('location path')

  const rest = (url: URL) => {
    const params = new URLSearchParams(url.search)
    params.delete(REDIRECT_PARAM)
    params.sort()
    return params.toString()
  }
  if (rest(forged) !== rest(plain)) out.push('location query')

  const backTo = (url: URL) => {
    const value = url.searchParams.get(REDIRECT_PARAM)
    return value === null ? null : new URL(value, RELATIVE_BASE)
  }
  const [plainBack, forgedBack] = [backTo(plain), backTo(forged)]
  if (!plainBack || !forgedBack) {
    if (plainBack || forgedBack) out.push(`${REDIRECT_PARAM} on one side only`)
    return out
  }
  if (!hostOk(forgedBack, plainBack)) out.push(`${REDIRECT_PARAM} host`)
  if (`${forgedBack.pathname}${forgedBack.search}` !== `${plainBack.pathname}${plainBack.search}`) out.push(`${REDIRECT_PARAM} path`)
  return out
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
