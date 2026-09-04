// Parsing for Apollo webhook payloads.
//
// Split out of the route so it can be tested directly: route.ts may only export
// HTTP handlers, and this is the part with the interesting failure modes.
//
// Apollo's webhook event names are configured in their admin UI and are not
// pinned by public developer docs, so nothing here matches one hard-coded
// constant. It reads whichever field actually carries the event type and
// matches on substring, which survives a rename like `email_clicked` →
// `emailer_message.clicked`.

import type { Engagement } from '@/lib/hubspot-deals'

/** Pull an email out of whichever envelope arrived. */
export function findEmail(payload: unknown): string | undefined {
  const seen = new Set<unknown>()
  const stack: unknown[] = [payload]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && /email/i.test(key) && value.includes('@')) {
        return value.trim().toLowerCase()
      }
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

/** First non-empty string found under any of `keys`, at any depth. */
export function findString(payload: unknown, keys: string[]): string | undefined {
  const wanted = new Set(keys.map((k) => k.toLowerCase()))
  const seen = new Set<unknown>()
  const stack: unknown[] = [payload]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object' || seen.has(node)) continue
    seen.add(node)
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim() && wanted.has(key.toLowerCase())) {
        return value.trim()
      }
      if (value && typeof value === 'object') stack.push(value)
    }
  }
  return undefined
}

/**
 * Normalise an explicit engagement label, e.g. the `?event=` query parameter
 * each Apollo workflow is pointed at.
 */
export function normaliseEngagement(value: string | null | undefined): Engagement | undefined {
  if (!value) return undefined
  const v = value.trim().toLowerCase()
  if (/repl/.test(v)) return 'replied'
  if (/click/.test(v)) return 'clicked'
  return undefined
}

const EVENT_KEYS = [
  'event',
  'event_type',
  'eventType',
  'type',
  'status',
  'email_status',
  'emailStatus',
]

/**
 * Classify the event from an explicit event-type field in the payload.
 *
 * This is the *fallback*. Apollo's "Send webhook" action posts the enrolled
 * contact record, and which trigger fired is a property of the workflow rather
 * than of the payload — so for a stock Apollo workflow there is usually no
 * event field here at all. The signal that actually distinguishes a click from
 * a reply is the URL each workflow is pointed at (`?event=clicked` /
 * `?event=replied`); this covers a hand-built payload that does say.
 *
 * Deliberately does NOT fall back to scanning the whole payload. Apollo's click
 * tracking rewrites every link into a redirect URL, so an *opened* event whose
 * body carries those links contains the substring "click" — a whole-payload
 * match would read it as a click and open a deal for someone who only opened
 * the mail. Guessing wrong invents pipeline; declining to guess loses nothing,
 * because the unrecognised payload is logged in full and the mapping can be
 * pinned once the first real event shows us the field.
 *
 * Reply is tested before click: a reply payload often carries the click
 * metadata of the message being replied to, and the further-along signal wins.
 */
export function classify(payload: unknown): Engagement | undefined {
  const raw = findString(payload, EVENT_KEYS)
  if (!raw) return undefined
  const value = raw.toLowerCase()
  if (/repl/.test(value)) return 'replied'
  if (/click/.test(value)) return 'clicked'
  return undefined
}
