import { emailLayout, escapeHtml, BRAND_NAVY, SIGN_OFF_HTML, SIGN_OFF_TEXT } from '@/lib/email-layout'
import { formatUsd } from '@/lib/scholarships'

// Scholarship emails: the staff alert, the applicant's acknowledgement, and the
// three offer emails (owner's spec, 2 Oct 2026) —
//   1. Congratulations, and a summary of the next two steps.
//   2. Complete your registration details (DocuSign follows from that).
//   3. Your payment link, with the scholarship already applied.
// A 100% scholarship has nothing to pay, so it gets 1 and 2 only.

const esc = escapeHtml

function button(href: string, label: string): string {
  return `<div style="margin:28px 0;text-align:center">
          <a href="${href}" style="display:inline-block;background:${BRAND_NAVY};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600">${esc(label)}</a>
        </div>`
}

const MUTED = 'color:#6b7280;font-size:14px'

// ── Staff ─────────────────────────────────────────────────────────────────────

export function scholarshipStaffAlertEmail(input: {
  name: string
  email: string
  phone: string | null
  activity: string
  school: string | null
  brief: string
  reviewUrl: string
}) {
  const rows: [string, string][] = [
    ['Name', esc(input.name)],
    ['Email', `<a href="mailto:${esc(input.email)}">${esc(input.email)}</a>`],
    ['Phone', esc(input.phone || '—')],
    ['Stellr activity', esc(input.activity)],
    ['School', esc(input.school || '—')],
    ['Application brief', esc(input.brief).replace(/\n/g, '<br/>')],
  ]
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;vertical-align:top">${label}</td><td style="padding:8px">${value}</td></tr>`,
    )
    .join('')
  const subject = `Scholarship Application — ${input.name}`
  const html = emailLayout({
    heading: 'New scholarship application',
    preheader: `${input.name} · ${input.activity}`,
    bodyHtml: `
        <table style="border-collapse:collapse;width:100%">${htmlRows}</table>
        ${button(input.reviewUrl, 'Review application →')}
        <p style="${MUTED}">Choose the scholarship level in Stellr. Offering it registers the student and sends them their emails.</p>`,
  })
  const text = [
    'New scholarship application',
    '',
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone || '—'}`,
    `Stellr activity: ${input.activity}`,
    `School: ${input.school || '—'}`,
    '',
    'Application brief:',
    input.brief,
    '',
    `Review application: ${input.reviewUrl}`,
  ].join('\n')
  return { subject, html, text }
}

// ── Applicant: acknowledgement ────────────────────────────────────────────────

export function scholarshipReceivedEmail(input: { firstName: string; activity: string }) {
  const subject = 'We’ve received your scholarship application'
  const html = emailLayout({
    heading: 'Application received',
    preheader: 'The scholarship committee will email you with a decision.',
    bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>Thanks for applying for a Stellr scholarship for <strong>${esc(input.activity)}</strong>. The scholarship committee reviews every application, and we’ll email you with a decision.</p>
        <p>There’s nothing else you need to do for now.</p>
        ${SIGN_OFF_HTML}`,
  })
  const text = `Hi ${input.firstName},\n\nThanks for applying for a Stellr scholarship for ${input.activity}. The scholarship committee reviews every application, and we'll email you with a decision.\n\nThere's nothing else you need to do for now.\n\n${SIGN_OFF_TEXT}`
  return { subject, html, text }
}

// ── Applicant: the three offer emails ─────────────────────────────────────────

export interface OfferEmailInput {
  firstName: string
  eventTitle: string
  /** e.g. "Sat 3 Oct 2026", or null when the event has no date yet. */
  eventDate: string | null
  percent: number
  /** The undiscounted fee, when known. */
  feeCents: number | null
  /** What the student pays after the scholarship, when known. */
  dueCents: number | null
  /** The student's registration details are already in (they registered before the offer). */
  detailsComplete: boolean
  /** Email 2's button: the registration form carrying the offer. */
  registerUrl: string
  /** The offer page: always shows the next step. */
  offerUrl: string
  /**
   * Registered and paid before the scholarship was awarded — the retrospective
   * case. Email 1 then reports the reimbursement instead of next steps, and
   * the only possible follow-up is the consent-form reminder.
   */
  alreadyPaid?: boolean
  /** The reimbursement made (or owed) for an already-paid student. */
  refund?: { method: 'cash' | 'credit' | 'manual' | 'none'; cents: number } | null
  /** No completed consent form (DocuSign) on the registration yet. */
  consentOutstanding?: boolean
}

function when(input: OfferEmailInput): string {
  return input.eventDate ? ` on ${input.eventDate}` : ''
}

function feeLine(input: OfferEmailInput): { html: string; text: string } {
  if (input.percent >= 100) {
    return { html: 'It covers the full participation fee.', text: 'It covers the full participation fee.' }
  }
  if (input.feeCents != null && input.dueCents != null) {
    const s = `It reduces your participation fee from ${formatUsd(input.feeCents)} to ${formatUsd(input.dueCents)}.`
    return { html: s, text: s }
  }
  return { html: `It takes ${input.percent}% off your participation fee.`, text: `It takes ${input.percent}% off your participation fee.` }
}

const CONSENT = 'Once your details are in, we email the participation consent form (DocuSign). If you’re under 18, a parent or guardian signs it.'

function refundLine(input: OfferEmailInput): string {
  const r = input.refund
  if (!r) return 'Your registration is confirmed — with a full scholarship there’s nothing to pay.'
  const amount = r ? formatUsd(r.cents) : ''
  if (r?.method === 'cash' && r.cents > 0) {
    return `You’d already registered and paid, so we’ve refunded ${amount} to the card you paid with. It usually shows within 5–10 business days.`
  }
  if (r?.method === 'credit' && r.cents > 0) {
    return `You’d already registered and paid, so we’ve added a ${amount} credit to your Stellr account for a future event or membership.`
  }
  if (r?.method === 'manual') {
    return r.cents > 0
      ? `You’d already registered and paid, so we owe you ${amount} — we’ll be in touch shortly to arrange it.`
      : 'You’d already registered and paid, so we’ll be in touch shortly about reimbursing the difference.'
  }
  return 'You’d already registered and paid the scholarship price, so there’s nothing more to pay or claim.'
}

/** Email 1 for a student who had already registered and paid. */
function scholarshipOfferEmailPaid(input: OfferEmailInput) {
  const refund = refundLine(input)
  const next = input.consentOutstanding
    ? 'One thing left: please make sure the participation consent form (DocuSign) is signed. If you’re under 18, a parent or guardian signs it — we’ve sent a reminder in a separate email.'
    : 'Your place is confirmed — there’s nothing else to do.'
  const subject = `You’ve been awarded a scholarship — ${input.eventTitle}`
  const html = emailLayout({
    heading: 'Congratulations!',
    preheader: `A ${input.percent}% scholarship for ${input.eventTitle}.`,
    bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>The Stellr scholarship committee has awarded you a <strong>${input.percent}% scholarship</strong> to take part in <strong>${esc(input.eventTitle)}</strong>${esc(when(input))}.</p>
        <p>${esc(refund)}</p>
        <p>${esc(next)}</p>
        ${button(input.offerUrl, 'View my scholarship →')}
        <p style="${MUTED}">Your scholarship and its status are also under <strong>Account</strong> when you sign in to Stellr.</p>
        ${SIGN_OFF_HTML}`,
  })
  const text = [
    `Hi ${input.firstName},`,
    '',
    `The Stellr scholarship committee has awarded you a ${input.percent}% scholarship to take part in ${input.eventTitle}${when(input)}.`,
    '',
    refund,
    '',
    next,
    '',
    `View your scholarship: ${input.offerUrl}`,
    '',
    SIGN_OFF_TEXT,
  ].join('\n')
  return { subject, html, text }
}

export function scholarshipOfferEmail(input: OfferEmailInput) {
  if (input.alreadyPaid) return scholarshipOfferEmailPaid(input)
  const free = input.percent >= 100
  const fee = feeLine(input)
  const pay = input.dueCents != null ? formatUsd(input.dueCents) : 'the remaining fee'

  const steps: { html: string; text: string }[] = []
  steps.push(
    input.detailsComplete
      ? {
          html: '<strong>Registration details</strong> — already in, thank you. If you haven’t yet, please make sure the consent form (DocuSign) we emailed is signed.',
          text: 'Registration details — already in, thank you. If you haven\'t yet, please make sure the consent form (DocuSign) we emailed is signed.',
        }
      : {
          html: `<strong>Complete your registration details.</strong> ${CONSENT}`,
          text: `Complete your registration details. ${CONSENT}`,
        },
  )
  if (!free) {
    steps.push({
      html: `<strong>Pay ${pay}.</strong> Your scholarship is already applied — no code needed.`,
      text: `Pay ${pay}. Your scholarship is already applied — no code needed.`,
    })
  }

  const subject = `You’ve been awarded a scholarship — ${input.eventTitle}`
  const html = emailLayout({
    heading: 'Congratulations!',
    preheader: `A ${input.percent}% scholarship for ${input.eventTitle}.`,
    bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>The Stellr scholarship committee has awarded you a <strong>${input.percent}% scholarship</strong> to take part in <strong>${esc(input.eventTitle)}</strong>${esc(when(input))}. ${fee.html}</p>
        <p>We’ve reserved your place. ${steps.length === 1 ? 'One step' : 'Two steps'} finish your registration — each has its own email so it’s easy to find:</p>
        <ol style="padding-left:20px">${steps.map((s) => `<li style="margin-bottom:8px">${s.html}</li>`).join('')}</ol>
        ${button(input.offerUrl, 'View my scholarship →')}
        <p style="${MUTED}">Your scholarship and its status are also under <strong>Account</strong> when you sign in to Stellr.</p>
        ${SIGN_OFF_HTML}`,
  })
  const text = [
    `Hi ${input.firstName},`,
    '',
    `The Stellr scholarship committee has awarded you a ${input.percent}% scholarship to take part in ${input.eventTitle}${when(input)}. ${fee.text}`,
    '',
    `We've reserved your place. ${steps.length === 1 ? 'One step' : 'Two steps'} finish your registration — each has its own email so it's easy to find:`,
    ...steps.map((s, i) => `${i + 1}. ${s.text}`),
    '',
    `View your scholarship: ${input.offerUrl}`,
    '',
    SIGN_OFF_TEXT,
  ].join('\n')
  return { subject, html, text }
}

export function scholarshipDetailsEmail(input: OfferEmailInput) {
  const free = input.percent >= 100
  const total = free ? 1 : 2

  if (input.alreadyPaid) {
    const subject = `One last step: your consent form — ${input.eventTitle}`
    const html = emailLayout({
      heading: 'Your consent form',
      preheader: 'The one thing left before the event.',
      bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>You’re registered for <strong>${esc(input.eventTitle)}</strong>. The one thing left is the participation consent form (DocuSign) we emailed when you registered — please make sure it’s signed. If you’re under 18, a parent or guardian signs it.</p>
        <p>Can’t find it? Reply to this email and we’ll send it again.</p>
        ${SIGN_OFF_HTML}`,
    })
    const text = `Hi ${input.firstName},\n\nYou're registered for ${input.eventTitle}. The one thing left is the participation consent form (DocuSign) we emailed when you registered — please make sure it's signed. If you're under 18, a parent or guardian signs it.\n\nCan't find it? Reply to this email and we'll send it again.\n\n${SIGN_OFF_TEXT}`
    return { subject, html, text }
  }

  if (input.detailsComplete) {
    const subject = `Step 1 of ${total}: your registration details are in — ${input.eventTitle}`
    const html = emailLayout({
      heading: 'Your details are in',
      preheader: 'Nothing more to fill in — just check the consent form is signed.',
      bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>You registered for <strong>${esc(input.eventTitle)}</strong> before your scholarship was awarded, so your details are already in — there’s nothing more to fill in.</p>
        <p>If you haven’t yet, please make sure the participation consent form (DocuSign) we emailed is signed. If you’re under 18, a parent or guardian signs it.</p>
        ${button(input.offerUrl, 'View my scholarship →')}
        ${SIGN_OFF_HTML}`,
    })
    const text = `Hi ${input.firstName},\n\nYou registered for ${input.eventTitle} before your scholarship was awarded, so your details are already in — there's nothing more to fill in.\n\nIf you haven't yet, please make sure the participation consent form (DocuSign) we emailed is signed. If you're under 18, a parent or guardian signs it.\n\nView your scholarship: ${input.offerUrl}\n\n${SIGN_OFF_TEXT}`
    return { subject, html, text }
  }

  const last = free ? '<p>That’s the only step — with a full scholarship there’s nothing to pay.</p>' : ''
  const lastText = free ? "\n\nThat's the only step — with a full scholarship there's nothing to pay." : ''
  const subject = `Step 1 of ${total}: complete your registration — ${input.eventTitle}`
  const html = emailLayout({
    heading: 'Complete your registration',
    preheader: 'About five minutes — then we send the consent form.',
    bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>Your place at <strong>${esc(input.eventTitle)}</strong> is reserved under your ${input.percent}% scholarship. Next, we need a few details only you can give us: your school, an emergency contact, your T-shirt size and so on. It takes about five minutes.</p>
        ${button(input.registerUrl, 'Complete my registration →')}
        <p>${CONSENT}</p>${last}
        <p style="${MUTED}">Use this button rather than the public event page — it carries your scholarship.</p>
        ${SIGN_OFF_HTML}`,
  })
  const text = `Hi ${input.firstName},\n\nYour place at ${input.eventTitle} is reserved under your ${input.percent}% scholarship. Next, we need a few details only you can give us: your school, an emergency contact, your T-shirt size and so on. It takes about five minutes.\n\nComplete your registration: ${input.registerUrl}\n\n${CONSENT}${lastText}\n\nUse this link rather than the public event page — it carries your scholarship.\n\n${SIGN_OFF_TEXT}`
  return { subject, html, text }
}

export function scholarshipPaymentEmail(input: OfferEmailInput) {
  const pay = input.dueCents != null ? formatUsd(input.dueCents) : null
  const saving =
    input.feeCents != null && pay
      ? `you pay <strong>${pay}</strong> instead of ${formatUsd(input.feeCents)}`
      : `${input.percent}% comes off your fee`
  const savingText =
    input.feeCents != null && pay ? `you pay ${pay} instead of ${formatUsd(input.feeCents)}` : `${input.percent}% comes off your fee`
  const order = input.detailsComplete
    ? ''
    : '<p>Complete your registration details first (step 1 — see our other email). The button below always takes you to whichever step is next.</p>'
  const orderText = input.detailsComplete
    ? ''
    : '\n\nComplete your registration details first (step 1 — see our other email). The link below always takes you to whichever step is next.'
  const subject = `Step 2 of 2: your payment link — ${input.eventTitle}`
  const html = emailLayout({
    heading: 'Your payment link',
    preheader: `Your ${input.percent}% scholarship is already applied.`,
    bodyHtml: `
        <p>Hi ${esc(input.firstName)},</p>
        <p>Your ${input.percent}% scholarship is already applied to <strong>${esc(input.eventTitle)}</strong>: ${saving}. There’s no code to enter.</p>${order}
        ${button(input.offerUrl, pay ? `Pay ${pay} →` : 'Pay now →')}
        <p style="${MUTED}">The link keeps working until registration closes. A parent or guardian can pay with their own email address for the receipt.</p>
        ${SIGN_OFF_HTML}`,
  })
  const text = `Hi ${input.firstName},\n\nYour ${input.percent}% scholarship is already applied to ${input.eventTitle}: ${savingText}. There's no code to enter.${orderText}\n\nPay: ${input.offerUrl}\n\nThe link keeps working until registration closes. A parent or guardian can pay with their own email address for the receipt.\n\n${SIGN_OFF_TEXT}`
  return { subject, html, text }
}
