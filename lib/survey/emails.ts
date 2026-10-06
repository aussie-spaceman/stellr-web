/**
 * Survey emails: the invitation, two "not started yet" nudges, the closing
 * reminder, the "finish your draft" reminder, and the link re-send from the
 * event-day QR page. Transactional, not marketing (handover §7), so no
 * marketing unsubscribe — but every one carries a "stop survey reminders"
 * link and a one-click List-Unsubscribe header pointing at the same thing.
 *
 * A minor's invitation that goes to a guardian asks them to pass it on and
 * never pretends to be addressed to the student.
 *
 * Copy is a draft for David's sign-off (handover §13 Q3).
 */
import { BRAND_NAVY, emailLayout, escapeHtml } from '@/lib/email-layout'
import type { RespondentRole } from './definition'
import { formatDateInZone } from './timezone'

export type SurveyEmailKind = 'invite' | 'nudge' | 'closing' | 'resume' | 'link'

export interface SurveyEmailInput {
  kind: SurveyEmailKind
  role: RespondentRole
  sendVia: 'self' | 'guardian'
  firstName: string | null
  eventTitle: string
  closesAt: string
  timeZone: string
  surveyUrl: string
  stopUrl: string
  minutes: number
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`

function paragraphs(lines: string[]): string {
  return lines.map((l) => `<p style="margin:0 0 14px">${l}</p>`).join('')
}

export function renderSurveyEmail(i: SurveyEmailInput): RenderedEmail {
  const event = i.eventTitle
  const closes = formatDateInZone(i.closesAt, i.timeZone)
  const name = i.firstName?.trim() || null
  const forGuardian = i.sendVia === 'guardian'
  const who = forGuardian ? (name ?? 'your student') : null
  const minutes = `about ${i.minutes} minutes`

  let subject: string
  let heading: string
  let body: string[]
  const cta = i.kind === 'resume' ? 'Finish the survey' : 'Start the survey'

  const thanks =
    i.role === 'mentor'
      ? `Thank you for mentoring at ${event}.`
      : i.role === 'adult'
        ? `Thank you for being part of ${event}.`
        : `Thanks for taking part in ${event}.`

  switch (i.kind) {
    case 'invite':
      subject = forGuardian ? `${who}’s feedback on ${event}` : `How was ${event}? ${i.minutes} minutes of feedback`
      heading = `Tell us about ${event}`
      body = forGuardian
        ? [
            `Hello,`,
            `${escapeHtml(who!)} took part in ${escapeHtml(event)}. Please pass this link to ${escapeHtml(who!)}: the survey is for them, takes ${minutes}, and saves as they go so they can finish later.`,
            `The link is personal to ${escapeHtml(who!)}. It closes on ${closes}.`,
          ]
        : [
            name ? `Hi ${escapeHtml(name)},` : 'Hello,',
            `${escapeHtml(thanks)} Tell us what worked and what we should change. It takes ${minutes}, and your answers save as you go.`,
            `The survey closes on ${closes}.`,
          ]
      break
    case 'nudge':
      subject = `A reminder: your ${event} survey`
      heading = `Your feedback on ${event}`
      body = forGuardian
        ? [`Hello,`, `${escapeHtml(who!)} hasn’t started their ${escapeHtml(event)} survey yet. If you can, please pass this link on. It takes ${minutes}.`]
        : [name ? `Hi ${escapeHtml(name)},` : 'Hello,', `You haven’t started your ${escapeHtml(event)} survey yet. It takes ${minutes}, and every answer shapes the next event.`]
      body.push(`It closes on ${closes}.`)
      break
    case 'closing':
      subject = `${event} survey closes in 3 days`
      heading = 'Three days left'
      body = forGuardian
        ? [`Hello,`, `The ${escapeHtml(event)} survey for ${escapeHtml(who!)} closes on ${closes}. If they’d like to have their say, please pass this link on.`]
        : [name ? `Hi ${escapeHtml(name)},` : 'Hello,', `The ${escapeHtml(event)} survey closes on ${closes}. If you have ${minutes}, we’d value your answers.`]
      break
    case 'resume':
      subject = `Finish your ${event} survey`
      heading = 'Pick up where you left off'
      body = forGuardian
        ? [`Hello,`, `${escapeHtml(who!)} started their ${escapeHtml(event)} survey but hasn’t submitted it. Their answers are saved; this link takes them back to where they stopped.`]
        : [name ? `Hi ${escapeHtml(name)},` : 'Hello,', `You started your ${escapeHtml(event)} survey. Your answers are saved, and this link takes you back to where you stopped.`]
      body.push(`It closes on ${closes}.`)
      break
    case 'link':
      subject = `Your ${event} survey link`
      heading = `Your ${event} survey`
      body = [
        'Hello,',
        forGuardian
          ? `Here is the survey link for ${escapeHtml(who!)}. Please pass it on: it takes ${minutes} and saves as they go.`
          : `Here is your survey link. It takes ${minutes} and saves as you go.`,
        `It closes on ${closes}.`,
      ]
      break
  }

  const footer = `<p style="margin:24px 0 0;font-size:13px">Don’t want survey reminders? <a href="${i.stopUrl}" style="color:${BRAND_NAVY}">Stop survey reminders</a>. This doesn’t affect any other Stellr email.</p>`
  const html = emailLayout({
    heading,
    preheader: forGuardian ? `A ${i.minutes}-minute survey for ${who}` : `${i.minutes} minutes, saves as you go`,
    bodyHtml: paragraphs(body) + button(i.surveyUrl, cta) + footer,
  })

  const strip = (s: string) =>
    s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
  const text = [
    ...body.map(strip),
    '',
    `${cta}: ${i.surveyUrl}`,
    '',
    `Stop survey reminders: ${i.stopUrl}`,
    '',
    'Stellr Education',
  ].join('\n')

  return { subject, html, text }
}
