import { isPrivatePath } from '@/lib/private-routes'

// Parsing for /api/csp-report. Browsers send CSP violation reports in two
// shapes:
//   - report-uri (Firefox, Safari, older Chrome): one object,
//     Content-Type application/csp-report, { "csp-report": { "document-uri", … } }
//   - Reporting API / report-to (Chrome, Edge): an array,
//     Content-Type application/reports+json,
//     [{ "type": "csp-violation", "url", "body": { "documentURL", … } }]
// Both become one compact line per violation. Nothing that could identify a
// person is kept: no query strings or fragments, no referrer, no user agent,
// no script sample, and a private-link path (its token is the key to someone's
// registration or agreement) is replaced by "[private]".

export const MAX_REPORT_BYTES = 16 * 1024
const MAX_PER_REQUEST = 20

export const REPORT_CONTENT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json']

export interface CspViolation {
  directive: string
  blocked: string
  document: string
  source: string
  disposition: string
}

type Obj = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

/**
 * A URL cut down to what's safe to log: origin and path, no query or fragment.
 * A same-site private-link path becomes "[private]". Keywords browsers use in
 * place of a URL ('inline', 'eval', 'data', …) pass through.
 */
export function scrubUrl(value: unknown): string {
  const raw = str(value).slice(0, 2048)
  if (!raw) return ''
  if (/^[a-z-]+$/i.test(raw)) return raw
  try {
    const u = new URL(raw)
    if (u.protocol === 'data:' || u.protocol === 'blob:') return u.protocol.slice(0, -1)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return u.protocol
    const path = isPrivatePath(u.pathname) ? '/[private]' : u.pathname
    return `${u.origin}${path}`.slice(0, 300)
  } catch {
    // A relative or malformed value: keep the path only.
    const path = raw.split(/[?#]/)[0]
    return (isPrivatePath(path) ? '/[private]' : path).slice(0, 300)
  }
}

function fromLegacy(r: Obj): CspViolation {
  const line = str(r['line-number'])
  return {
    directive: str(r['effective-directive'] || r['violated-directive']).split(' ')[0].slice(0, 40),
    blocked: scrubUrl(r['blocked-uri']),
    document: scrubUrl(r['document-uri']),
    source: scrubUrl(r['source-file']) + (line ? `:${line}` : ''),
    disposition: str(r.disposition).slice(0, 10),
  }
}

function fromReportingApi(b: Obj): CspViolation {
  const line = str(b.lineNumber)
  return {
    directive: str(b.effectiveDirective).slice(0, 40),
    blocked: scrubUrl(b.blockedURL),
    document: scrubUrl(b.documentURL),
    source: scrubUrl(b.sourceFile) + (line ? `:${line}` : ''),
    disposition: str(b.disposition).slice(0, 10),
  }
}

/** The violations in a parsed report body; [] for anything unrecognised. */
export function parseCspReports(body: unknown): CspViolation[] {
  if (Array.isArray(body)) {
    return body
      .slice(0, MAX_PER_REQUEST)
      .filter((r): r is Obj => !!r && typeof r === 'object' && (r as Obj).type === 'csp-violation')
      .map((r) => (r.body && typeof r.body === 'object' ? fromReportingApi(r.body as Obj) : null))
      .filter((v): v is CspViolation => v !== null)
  }
  if (body && typeof body === 'object' && (body as Obj)['csp-report'] && typeof (body as Obj)['csp-report'] === 'object') {
    return [fromLegacy((body as Obj)['csp-report'] as Obj)]
  }
  return []
}

/** One log line. */
export function formatViolation(v: CspViolation): string {
  return `[csp] ${v.disposition || 'report'} ${v.directive || '?'} blocked=${v.blocked || '?'} doc=${v.document || '?'}${v.source ? ` src=${v.source}` : ''}`
}
