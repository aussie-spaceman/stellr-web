/**
 * Prove the Motion booking webhook works, before wiring anything to it.
 *
 *   MOTION_WEBHOOK_SECRET=<secret> npx tsx scripts/test-motion-webhook.ts <email> [--prod]
 *
 * Signs a payload exactly the way the receiver expects and posts it, so a
 * failure here is the endpoint or the secret — not Zapier. Run it against a
 * contact that already exists in HubSpot, because the route deliberately
 * refuses to create contacts: a booking from any other source must not be able
 * to invent a landing-page lead.
 *
 * It also prints the exact body and signature, which is what a Zapier Code
 * step has to reproduce byte for byte. The signature covers the raw body, so
 * any re-serialisation between signing and sending breaks it.
 */
import { createHmac } from 'node:crypto'

const LOCAL = 'http://localhost:3000/api/webhooks/motion'
const PROD = 'https://www.stellreducation.org/api/webhooks/motion'

async function main() {
  const args = process.argv.slice(2)
  const email = args.find((a) => a.includes('@'))
  const url = args.includes('--prod') ? PROD : LOCAL
  const secret = process.env.MOTION_WEBHOOK_SECRET

  if (!email) {
    console.error('Usage: MOTION_WEBHOOK_SECRET=<secret> npx tsx scripts/test-motion-webhook.ts <email> [--prod]')
    process.exit(1)
  }
  if (!secret) {
    console.error('MOTION_WEBHOOK_SECRET is not set in this shell.')
    console.error('It cannot be read back out of Vercel — use the value you recorded when rotating it.')
    process.exit(1)
  }

  // Only these two fields. Deliberately NOT the whole calendar event: the
  // receiver finds the first email-shaped value anywhere in the payload, and a
  // raw calendar event contains the organiser's address too — which would stamp
  // "call booked" on the wrong contact.
  const payload = { email, startTime: new Date().toISOString() }
  const body = JSON.stringify(payload)
  const signature = createHmac('sha256', secret).update(body).digest('hex')

  console.log(`POST ${url}`)
  console.log(`  body      ${body}`)
  console.log(`  signature ${signature}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Motion-Signature': signature },
    body,
  })
  const text = await res.text()
  console.log(`\n  → ${res.status} ${text}`)

  const explain: Record<number, string> = {
    200: 'Accepted. `matched: true` means the contact was found and stamped; `matched: false` means no such contact in HubSpot (expected for an unknown address).',
    401: 'Signature rejected — the secret in this shell does not match the deployment, or the body was altered after signing.',
    422: 'No email found in the payload.',
    503: 'MOTION_WEBHOOK_SECRET is not set on the deployment. Add it and redeploy.',
  }
  if (explain[res.status]) console.log(`\n  ${explain[res.status]}`)
  process.exitCode = res.ok ? 0 : 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
