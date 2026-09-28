// Renders one event email for one recipient: merge fields → subject, a letter-
// style HTML body with David's signature, and a plain-text alternative.
//
// Not emailLayout(): that is the marketing card (header logo, heading, postal
// footer). These are personal letters about a registration, sent as David with
// replies to his inbox, and should read like the ones he sent from Outlook.

import { tiptapToEmailHtml, substituteTokens, extractTokens } from '@/lib/email-render'
import { escapeHtml } from '@/lib/email-layout'
import { SITE_URL, AUTH_APP_URL } from '@/lib/env'
import { EVENT_MERGE_FIELDS, type RecipientRole } from './types'
import { daysUntil } from './schedule'

export const EVENT_EMAIL_FROM = 'David Shaw, Stellr Education <hello@mail.stellreducation.org>'
export const EVENT_EMAIL_REPLY_TO = 'david.shaw@stellreducation.org'

const TIME_ZONE = 'America/Denver' // matches lib/utils APP_TIME_ZONE

// ── Event-level fields ────────────────────────────────────────────────────────

export interface EventForEmail {
  slug: string
  title: string
  date?: string | null
  venue?: string | null
  city?: string | null
  state?: string | null
  startTime?: string | null
  endTime?: string | null
}

/** "2026-10-03" → "Saturday, October 3". */
export function formatEventDate(date: string | null | undefined): string {
  if (!date) return ''
  return new Date(`${date.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

/** "08:30" → "8:30 AM". */
export function formatClock(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return ''
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`
}

/** Today's calendar date in Mountain time, as YYYY-MM-DD. */
export function todayInMountain(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
}

export function eventMergeVars(event: EventForEmail, today = todayInMountain()): Record<string, string> {
  return {
    event_name:       event.title,
    event_venue:      event.venue ?? '',
    event_city:       [event.city, event.state].filter(Boolean).join(', '),
    event_date:       formatEventDate(event.date),
    event_start_time: formatClock(event.startTime),
    event_end_time:   formatClock(event.endTime),
    days_to_go:       event.date ? String(Math.max(0, daysUntil(event.date, today))) : '',
    portal_link:      `${AUTH_APP_URL}/sign-in`,
    event_link:       `${SITE_URL}/events/${event.slug}`,
  }
}

// ── Recipient-level fields ────────────────────────────────────────────────────

export interface PaymentLine {
  participantName: string
  /** Durable pay page; null when paid by invoice or per-member links. */
  payUrl: string | null
  method: 'link' | 'invoice' | 'individual'
}

export interface RecipientForRender {
  email: string
  firstName: string
  roles: RecipientRole[]
  /** First names of the participant(s) this person is emailed about. */
  participantNames: string[]
  /** True when the recipient is themselves the registered participant. */
  isParticipant: boolean
  payments: PaymentLine[]
}

function joinNames(names: string[]): string {
  const uniq = [...new Set(names.filter(Boolean))]
  if (uniq.length <= 1) return uniq[0] ?? ''
  return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`
}

function whoIsRegistered(r: RecipientForRender): string {
  if (r.isParticipant) return 'you are'
  const names = [...new Set(r.participantNames.filter(Boolean))]
  if (names.length === 0) return 'you are'
  return `${joinNames(names)} ${names.length === 1 ? 'is' : 'are'}`
}

function paymentText(lines: PaymentLine[]): string {
  if (lines.length === 0) return ''
  const multi = lines.length > 1
  return lines
    .map((l) => {
      const who = multi ? ` for ${l.participantName}` : ''
      if (l.method === 'link' && l.payUrl) return `You can pay securely${who} here: ${l.payUrl}`
      if (l.method === 'invoice') return `This registration${who} is paid by invoice. Reply here if you need a copy of it.`
      return `Your payment link${who} was emailed to you separately. Reply here if you need it re-sent.`
    })
    .join('\n')
}

function link(href: string, label?: string): string {
  return `<a href="${href}" style="color:#1e3a5f;text-decoration:underline">${label ?? href}</a>`
}

export function recipientMergeVars(r: RecipientForRender): Record<string, string> {
  return {
    first_name:           r.firstName || 'there',
    who_is_registered:    whoIsRegistered(r),
    participant_names:    joinNames(r.participantNames) || r.firstName,
    payment_instructions: paymentText(r.payments),
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const KNOWN = new Set<string>(EVENT_MERGE_FIELDS.map((f) => f.token))
const URL_FIELDS = new Set(['portal_link', 'event_link'])

/** Merge fields used in the subject or body that the engine can't fill. */
export function unknownTokens(subject: string, bodyJson: unknown): string[] {
  const used = [...extractTokens(subject), ...extractTokens(JSON.stringify(bodyJson ?? ''))]
  return [...new Set(used.filter((t) => !KNOWN.has(t)))]
}

type Node = { type?: string; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; content?: Node[] }

/** Plain-text projection that keeps bullets and link targets. */
export function tiptapToEmailText(doc: unknown, depth = 0): string {
  const node = doc as Node | null
  if (!node || typeof node !== 'object') return ''
  const kids = (n: Node, d = depth) => (n.content ?? []).map((c) => tiptapToEmailText(c, d)).join('')
  switch (node.type) {
    case 'doc': return (node.content ?? []).map((c) => tiptapToEmailText(c, depth)).join('\n').trim()
    case 'text': {
      const href = node.marks?.find((m) => m.type === 'link')?.attrs?.href
      return href && href !== node.text ? `${node.text} (${String(href)})` : node.text ?? ''
    }
    case 'paragraph': return `${kids(node)}\n`
    case 'hardBreak': return '\n'
    case 'bulletList':
    case 'orderedList':
      return (node.content ?? [])
        .map((li, i) => `${'  '.repeat(depth)}${node.type === 'orderedList' ? `${i + 1}.` : '-'} ${tiptapToEmailText(li, depth + 1).trim()}`)
        .join('\n') + (depth === 0 ? '\n' : '')
    case 'listItem':
      return (node.content ?? []).map((c) => (c.type === 'paragraph' ? kids(c).trim() : `\n${tiptapToEmailText(c, depth)}`)).join('')
    default: return kids(node)
  }
}

const SIGNATURE_HTML = `
<p style="margin:24px 0 16px">All the best,</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
  <tr>
    <td style="padding-right:16px;vertical-align:top;width:175px">
      <a href="https://www.stellreducation.org/"><img src="https://www.stellreducation.org/email/signature-logo.png" alt="Stellr Education — The Engineering Education Community" width="175" height="200" style="width:175px;height:200px;max-width:100%;display:block;border:0" /></a>
    </td>
    <td style="vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#222222">
      <b>David Shaw</b><br/>
      Chief Inspiration Officer<br/>
      Stellr Education<br/>
      P: <a href="tel:+17026820757" style="color:#1155cc">+1 (702) 682-0757</a><br/>
      E: <a href="mailto:david.shaw@stellreducation.org" style="color:#1155cc">david.shaw@stellreducation.org</a><br/>
      W: <a href="https://www.stellreducation.org/" style="color:#1155cc">www.stellreducation.org</a><br/>
      B: <a href="https://app.usemotion.com/meet/david-m-shaw/check-in" style="color:#1155cc">Schedule A Meeting</a>
    </td>
  </tr>
</table>`

const SIGNATURE_TEXT = [
  'All the best,',
  '',
  'David Shaw',
  'Chief Inspiration Officer',
  'Stellr Education',
  'P: +1 (702) 682-0757',
  'E: david.shaw@stellreducation.org',
  'W: www.stellreducation.org',
].join('\n')

export interface RenderedEventEmail { subject: string; html: string; text: string }

export function renderEventEmail(
  email: { subject: string; body_json: unknown },
  vars: Record<string, string>,
): RenderedEventEmail {
  const htmlVars: Record<string, string> = {}
  for (const [k, v] of Object.entries(vars)) {
    htmlVars[k] = URL_FIELDS.has(k) && v ? link(v) : escapeHtml(v)
  }
  // payment_instructions carries its own markup (link + line breaks).
  if ('payment_instructions' in vars) htmlVars.payment_instructions = paymentHtmlFromText(vars.payment_instructions)

  const subject = substituteTokens(email.subject, vars).replace(/\s+/g, ' ').trim()
  const bodyHtml = substituteTokens(tiptapToEmailHtml(email.body_json), htmlVars)
    // An empty merge field (e.g. no payment note) must not leave a blank paragraph.
    .replace(/<p style="margin:0 0 16px"><\/p>/g, '')
  const bodyText = substituteTokens(tiptapToEmailText(email.body_json), vars).replace(/\n{3,}/g, '\n\n')

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#000000;max-width:640px">
${bodyHtml}
${SIGNATURE_HTML}
</div>`
  return { subject, html, text: `${bodyText.trim()}\n\n${SIGNATURE_TEXT}\n` }
}

function paymentHtmlFromText(text: string): string {
  if (!text) return ''
  return escapeHtml(text)
    .split('\n')
    .map((line) => line.replace(/(https?:\/\/[^\s<]+)/g, (url) => link(url, 'Pay now')))
    .join('<br/>')
}

// Exported for tests.
export const __test = { paymentText, paymentHtmlFromText, whoIsRegistered }
