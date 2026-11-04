// The provider behind sendEmail() (lib/email.ts).
//
// sendEmail decides WHETHER and TO WHOM a message goes (recipient routing
// outside production, the suppression list, the shared daily budget). A
// transport only delivers what it is handed. Keeping the provider behind this
// interface means Amazon SES can be added later (plan S1: Resend Free until
// sends pass about 80 a day, then SES) without touching sendEmail's 58 callers.
//
// resendTransport() is today's raw fetch to Resend, moved here unchanged: the
// same endpoint, headers, JSON body (field names and order), error log and
// EmailSendError. Its tests pin that.

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

export interface EmailTransport {
  /** Short provider name for logs, e.g. "resend". */
  readonly name: string
  /** Deliver one message. Throws EmailSendError when the provider refuses it. */
  send(message: OutgoingEmail): Promise<TransportResult>
}

/**
 * A send the provider refused. `status` 429 is the rate limit or the plan's
 * daily quota: a sender working through a queue should stop and try later, not
 * carry on and fail the rest.
 */
export class EmailSendError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'EmailSendError'
    this.status = status
  }
  get isQuota(): boolean {
    return this.status === 429
  }
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

/** Resend over its REST API. Exactly the request sendEmail made before the interface existed. */
export function resendTransport(apiKey: string): EmailTransport {
  return {
    name: 'resend',
    async send(message) {
      const { from, to, cc, replyTo, subject, html, text, headers, attachments } = message
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
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
        throw new EmailSendError(`Failed to send email: ${err}`, res.status)
      }
      const body = await res.json().catch(() => null) as { id?: string } | null
      return { id: body?.id ?? null }
    },
  }
}
