// The provider behind sendEmail() (lib/email.ts).
//
// sendEmail decides WHETHER and TO WHOM a message goes (recipient routing
// outside production, the suppression list, the shared daily budget). A
// transport only delivers what it is handed. Keeping the provider behind this
// interface means Amazon SES can be added later (plan S1: Resend Free until
// sends pass about 80 a day, then SES) without touching sendEmail's 58 callers.
//
// resendTransport() is the raw fetch to Resend: the same endpoint, headers,
// JSON body (field names and order), error log and EmailSendError as before the
// interface existed. Its tests pin that. The only additions are an optional
// Idempotency-Key header (outbox retries) and the error's code / Retry-After.

export interface TransportAttachment {
  filename: string
  /** Base64-encoded file content. */
  content: string
  contentType?: string
}

/** A message sendEmail has already routed and approved. */
export interface OutgoingEmail {
  from: string
  to: string[]
  cc: string[]
  replyTo: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  attachments?: TransportAttachment[]
}

export interface TransportResult {
  /** The provider's message id, when it returned one. */
  id: string | null
}

export interface SendOptions {
  /**
   * Sent as Resend's Idempotency-Key header. The email outbox (lib/email/outbox.ts)
   * passes its row id, so a retry of a send Resend already accepted (a function
   * killed between Resend's answer and the row update) is not delivered twice.
   */
  idempotencyKey?: string
}

export interface EmailTransport {
  /** Short provider name for logs, e.g. "resend". */
  readonly name: string
  /** Deliver one message. Throws EmailSendError when the provider refuses it. */
  send(message: OutgoingEmail, opts?: SendOptions): Promise<TransportResult>
}

/**
 * A send the provider refused. `status` 429 is the rate limit or the plan's
 * daily quota: a sender working through a queue should stop and try later, not
 * carry on and fail the rest. `code` is Resend's error name when the body had
 * one (`rate_limit_exceeded`, `daily_quota_exceeded`, `monthly_quota_exceeded`,
 * `validation_error`, …).
 */
export class EmailSendError extends Error {
  readonly status: number
  readonly code: string | null
  /** From a Retry-After header, when the provider sent one. */
  readonly retryAfterMs: number | null
  constructor(message: string, status: number, code: string | null = null, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'EmailSendError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
  get isQuota(): boolean {
    return this.status === 429
  }
  /** The per-second rate limit: worth retrying in a second or two, unlike the daily quota. */
  get isRateLimit(): boolean {
    return this.status === 429 && this.code === 'rate_limit_exceeded'
  }
  /**
   * The message itself is bad (a malformed address, a missing field): sending
   * it again tomorrow fails the same way. Everything else — the quota, the rate
   * limit, a provider outage, a revoked key or an unverified domain — is a
   * reason to wait and retry, never to drop the mail.
   */
  get isPermanent(): boolean {
    return this.status === 400 || this.status === 422
  }
}

function errorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { name?: unknown }
    return typeof parsed?.name === 'string' ? parsed.name : null
  } catch {
    return null
  }
}

function retryAfter(res: Response): number | null {
  const raw = res.headers?.get?.('retry-after')
  if (raw == null || raw === '') return null
  const secs = Number(raw)
  return Number.isFinite(secs) && secs >= 0 ? Math.round(secs * 1000) : null
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Resend over its REST API. Exactly the request sendEmail made before the interface existed. */
export function resendTransport(apiKey: string): EmailTransport {
  return {
    name: 'resend',
    async send(message, opts = {}) {
      const { from, to, cc, replyTo, subject, html, text, headers, attachments } = message
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          from,
          to,
          cc,
          reply_to: replyTo,
          subject,
          html,
          text,
          ...(headers && Object.keys(headers).length ? { headers } : {}),
          ...(attachments && attachments.length
            ? {
                attachments: attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content,
                  content_type: a.contentType,
                })),
              }
            : {}),
        }),
      })

      if (!res.ok) {
        const err = await res.text()
        console.error('[email] Resend error sending to', (to[0] ?? '').replace(/^.*@/, '…@'), '—', err)
        throw new EmailSendError(`Failed to send email: ${err}`, res.status, errorCode(err), retryAfter(res))
      }
      const body = await res.json().catch(() => null) as { id?: string } | null
      return { id: body?.id ?? null }
    },
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Send, waiting out Resend's per-second rate limit (a 429 named
 * rate_limit_exceeded) up to `attempts` times. Any other refusal — including
 * the daily or monthly quota — is thrown straight away for the caller to queue.
 */
export async function sendRespectingRateLimit(
  transport: EmailTransport,
  message: OutgoingEmail,
  opts: SendOptions & { attempts?: number } = {},
): Promise<TransportResult> {
  const attempts = opts.attempts ?? 3
  for (let i = 1; ; i++) {
    try {
      return await transport.send(message, { idempotencyKey: opts.idempotencyKey })
    } catch (err) {
      if (!(err instanceof EmailSendError) || !err.isRateLimit || i >= attempts) throw err
      await sleep(Math.min(err.retryAfterMs ?? 1000 * i, 5000))
    }
  }
}
