import { BRAND_NAVY, emailLayout, escapeHtml as esc, SIGN_OFF_HTML, SIGN_OFF_TEXT } from '@/lib/email-layout'
import { SITE_URL } from '@/lib/env'

// The emails Stellr signing sends. With DocuSign, DocuSign emailed the signing
// link and we sent a heads-up; with Stellr signing ours is the only email, so
// it carries the link and everything a parent is owed before consenting:
// what is collected, why, that consent is needed, and how to say no.
//
// Transactional only: no promotion, so the messages stay outside the rules
// for marketing email. Every interpolated value is escaped. Signed documents
// are never attached: they are fetched through a gated link.

type Role = 'guardian' | 'student' | 'adult' | 'mentor' | 'member' | 'stellr'

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">${esc(label)}</a></p>`
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

export interface SignatureRequestInput {
  role: Role
  recipientName: string
  /** "Parental Consent Form", "Membership Agreement", … */
  documentLabel: string
  eventTitle: string | null
  /** The child or member the document is about, when that is not the recipient. */
  subjectName: string | null
  url: string
  expiresAt: string
  reminder: boolean
  /** The student's own copy, sent once the parent has signed. */
  afterGuardian?: boolean
}

export function signatureRequestEmail(i: SignatureRequestInput) {
  const forEvent = i.eventTitle ? ` for ${i.eventTitle}` : ''
  const who = i.role === 'guardian' && i.subjectName ? ` for ${i.subjectName}` : ''
  const subject = i.reminder
    ? `Reminder: please sign the ${i.documentLabel}${who}${forEvent}`
    : i.role === 'guardian'
      ? `Parent/guardian signature needed: ${i.documentLabel}${who}${forEvent}`
      : `Your signature: ${i.documentLabel}${forEvent}`

  const membership = i.documentLabel === 'Membership Agreement'
  const child = i.subjectName ? esc(i.subjectName) : 'Your child'
  const lead = i.role === 'guardian'
    ? membership
      ? `${child} is joining Stellr Education as a member. Because they are under 18, we need a parent or legal guardian to read and sign the ${esc(i.documentLabel)} first.`
      : `${child} is taking part${esc(forEvent)}. Before they can, we need a parent or legal guardian to read and sign the ${esc(i.documentLabel)}.`
    : i.afterGuardian
      ? `Your parent or guardian has signed. Now it's your turn: please read and sign the ${esc(i.documentLabel)}${esc(forEvent)}.`
      : `Please read and sign the ${esc(i.documentLabel)}${esc(forEvent)}.`

  const covers = membership
    ? 'The agreement sets out what membership includes, how your child\'s information is used, and the choices you can make about it.'
    : 'The form records your consent for your child to take part, for the information on the form to be used to run the event, and a release of liability. It also has two choices you can make: to opt out of photo and media use, and to opt out of direct digital communication with your child. Neither affects their participation.'
  const guardianNotice = i.role === 'guardian'
    ? `<p style="margin:0 0 12px"><strong>What this covers.</strong> ${covers}</p>
      <p style="margin:0 0 12px"><strong>What we record when you sign.</strong> Your name, email, the date and time, and the internet address and browser you sign from, so the signature can be shown to be yours. Our <a href="${esc(SITE_URL)}/privacy" style="color:${BRAND_NAVY}">Privacy Policy</a> explains how we use and protect it.</p>
      <p style="margin:0 0 12px">If you don't want to sign, you can decline on the signing page, or reply to this email. ${membership ? 'Membership needs a signed agreement.' : 'Your child can\'t take part without a signed form.'} To sign on paper instead, reply and we'll post one.</p>`
    : `<p style="margin:0 0 12px">When you sign we record your name, email, the date and time, and the internet address and browser you sign from. Our <a href="${esc(SITE_URL)}/privacy" style="color:${BRAND_NAVY}">Privacy Policy</a> explains how we use it.</p>`

  const html = emailLayout({
    heading: i.reminder ? 'A signature is still needed' : 'Your signature is needed',
    preheader: `${i.documentLabel}${forEvent}. The link works until ${formatDay(i.expiresAt)}.`,
    bodyHtml: `
      <p style="margin:0 0 16px">Hi ${esc(i.recipientName)},</p>
      <p style="margin:0 0 12px">${lead}</p>
      ${button(i.url, i.reminder ? 'Review and sign' : 'Review and sign')}
      <p style="margin:0 0 12px">The link is just for you and works until ${esc(formatDay(i.expiresAt))}. Please don't forward it.</p>
      ${guardianNotice}
      <p style="margin:0 0 16px">The form is signed through Stellr's own signing system at stellreducation.org. You won't hear from DocuSign about this one.</p>
      ${SIGN_OFF_HTML}`,
  })

  const text = [
    `Hi ${i.recipientName},`,
    '',
    lead.replace(/<[^>]+>/g, ''),
    '',
    `Review and sign: ${i.url}`,
    '',
    `The link is just for you and works until ${formatDay(i.expiresAt)}. Please don't forward it.`,
    '',
    i.role === 'guardian'
      ? 'When you sign we record your name, email, the date and time, and the internet address and browser you sign from. You can opt out of photo and media use and of direct digital communication with your child on the form; neither affects participation. To decline, use the signing page or reply to this email. To sign on paper, reply and we will post a form.'
      : 'When you sign we record your name, email, the date and time, and the internet address and browser you sign from.',
    `Privacy Policy: ${SITE_URL}/privacy`,
    '',
    SIGN_OFF_TEXT,
  ].join('\n')

  return { subject, html, text }
}

export interface SignatureBundleItem {
  documentLabel: string
  eventTitle: string | null
  /** The child or member the document is about. */
  subjectName: string
  url: string
  expiresAt: string
}

const CONSENT_COVERS = 'Each form records your consent for your child to take part, for the information on it to be used to run the event, and a release of liability. Each also has two choices you can make: to opt out of photo and media use, and to opt out of direct digital communication with your child. Neither affects their participation.'
const MEMBERSHIP_COVERS = 'The membership agreement sets out what membership includes, how your child\'s information is used, and the choices you can make about it.'

/**
 * One email to a parent or guardian with several forms to sign (siblings in
 * one registration), each with its own link. One message, not one per child:
 * it is easier to act on, and spends one of the day's sends rather than several.
 */
export function signatureBundleEmail(i: { recipientName: string; items: SignatureBundleItem[]; reminder: boolean }) {
  const names = i.items.map((x) => x.subjectName)
  const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
  const events = [...new Set(i.items.map((x) => x.eventTitle).filter(Boolean))] as string[]
  const forEvent = events.length === 1 ? ` for ${events[0]}` : ''
  const subject = i.reminder
    ? `Reminder: ${i.items.length} forms to sign for ${joined}${forEvent}`
    : `Parent/guardian signature needed: ${i.items.length} forms for ${joined}${forEvent}`
  const allMembership = i.items.every((x) => x.documentLabel === 'Membership Agreement')
  const covers = [...new Set(i.items.map((x) => (x.documentLabel === 'Membership Agreement' ? MEMBERSHIP_COVERS : CONSENT_COVERS)))].join(' ')
  const lead = allMembership
    ? `${joined} are joining Stellr Education as members. Because they are under 18, we need a parent or legal guardian to read and sign an agreement for each of them.`
    : `${joined} are taking part${forEvent}. Before they can, we need a parent or legal guardian to read and sign a form for each of them.`
  const latest = i.items.map((x) => x.expiresAt).sort()[0]

  const html = emailLayout({
    heading: i.reminder ? 'Signatures are still needed' : 'Your signature is needed',
    preheader: `${i.items.length} forms${forEvent}. The links work until ${formatDay(latest)}.`,
    bodyHtml: `
      <p style="margin:0 0 16px">Hi ${esc(i.recipientName)},</p>
      <p style="margin:0 0 12px">${esc(lead)}</p>
      ${i.items.map((x) => `
      <p style="margin:20px 0 0"><strong>${esc(x.subjectName)}</strong>: ${esc(x.documentLabel)}${x.eventTitle && events.length > 1 ? ` for ${esc(x.eventTitle)}` : ''}</p>
      ${button(x.url, `Review and sign for ${x.subjectName}`)}`).join('')}
      <p style="margin:0 0 12px">Each link is just for you and works until ${esc(formatDay(latest))}. Please don't forward them.</p>
      <p style="margin:0 0 12px"><strong>What this covers.</strong> ${covers}</p>
      <p style="margin:0 0 12px"><strong>What we record when you sign.</strong> Your name, email, the date and time, and the internet address and browser you sign from, so each signature can be shown to be yours. Our <a href="${esc(SITE_URL)}/privacy" style="color:${BRAND_NAVY}">Privacy Policy</a> explains how we use and protect it.</p>
      <p style="margin:0 0 12px">If you don't want to sign, you can decline on the signing page, or reply to this email. ${allMembership ? 'Membership needs a signed agreement.' : 'A child can\'t take part without a signed form.'} To sign on paper instead, reply and we'll post them.</p>
      <p style="margin:0 0 16px">These are signed through Stellr's own signing system at stellreducation.org. You won't hear from DocuSign about them.</p>
      ${SIGN_OFF_HTML}`,
  })

  const text = [
    `Hi ${i.recipientName},`,
    '',
    lead,
    '',
    ...i.items.flatMap((x) => [`${x.subjectName}, ${x.documentLabel}: ${x.url}`]),
    '',
    `Each link is just for you and works until ${formatDay(latest)}. Please don't forward them.`,
    '',
    'When you sign we record your name, email, the date and time, and the internet address and browser you sign from. You can opt out of photo and media use and of direct digital communication with your child on each form; neither affects participation. To decline, use the signing page or reply to this email. To sign on paper, reply and we will post the forms.',
    `Privacy Policy: ${SITE_URL}/privacy`,
    '',
    SIGN_OFF_TEXT,
  ].join('\n')

  return { subject, html, text }
}

export interface CompletedInput {
  recipientName: string
  documentLabel: string
  eventTitle: string | null
  /** A link that gets the signer their copy. Never the document itself. */
  copyUrl: string
  copyUntil: string | null
  /** Members can also find it in their account. */
  accountUrl: string | null
}

export function agreementCompletedEmail(i: CompletedInput) {
  const forEvent = i.eventTitle ? ` for ${i.eventTitle}` : ''
  const subject = `Signed: ${i.documentLabel}${forEvent}`
  const html = emailLayout({
    heading: 'All signed',
    preheader: `${i.documentLabel}${forEvent} is complete.`,
    bodyHtml: `
      <p style="margin:0 0 16px">Hi ${esc(i.recipientName)},</p>
      <p style="margin:0 0 12px">Everyone has signed the ${esc(i.documentLabel)}${esc(forEvent)}. Thank you.</p>
      ${button(i.copyUrl, 'Download your signed copy')}
      <p style="margin:0 0 12px">${i.copyUntil ? `This link works until ${esc(formatDay(i.copyUntil))}. ` : ''}Please save a copy for your records.${i.accountUrl ? ` You can also find it in <a href="${esc(i.accountUrl)}" style="color:${BRAND_NAVY}">your Stellr account</a>.` : ' For another copy later, email privacy@stellreducation.org.'}</p>
      ${SIGN_OFF_HTML}`,
  })
  const text = [
    `Hi ${i.recipientName},`,
    '',
    `Everyone has signed the ${i.documentLabel}${forEvent}. Thank you.`,
    '',
    `Download your signed copy: ${i.copyUrl}`,
    i.copyUntil ? `This link works until ${formatDay(i.copyUntil)}. Please save a copy for your records.` : '',
    i.accountUrl ? `You can also find it in your Stellr account: ${i.accountUrl}` : 'For another copy later, email privacy@stellreducation.org.',
    '',
    SIGN_OFF_TEXT,
  ].join('\n')
  return { subject, html, text }
}
