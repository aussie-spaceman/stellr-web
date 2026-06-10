// SMS delivery — DEFERRED to a future build.
//
// The product needs "email or SMS" reminders for training and coaching/mentoring
// sessions, but SMS is gated on:
//   1. A provider account — Twilio (recommended).
//   2. US A2P 10DLC brand + campaign registration (10–15 day carrier review).
//   3. TCPA consent: SMS for minors goes to the parent/guardian, and a member's
//      sms_consent_at / sms_number (member_notification_prefs, migration 017)
//      must be set before any message is sent.
//
// Until then this is a no-op that logs intent. lib/notify.ts already routes by
// channel preference and will start delivering real SMS the moment sendSms is
// implemented — no call-site changes required.
//
// To implement: add `twilio` dep, set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
// TWILIO_MESSAGING_SERVICE_SID, and replace the body below with a client.send().

export interface SmsOptions {
  to: string
  body: string
}

export async function sendSms({ to, body }: SmsOptions): Promise<{ sent: boolean }> {
  console.info(`[sms:deferred] would send to ${to}: ${body.slice(0, 80)}`)
  return { sent: false }
}

/** Whether SMS is live yet. Used by lib/notify to decide the channel. */
export const SMS_ENABLED = Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID)
