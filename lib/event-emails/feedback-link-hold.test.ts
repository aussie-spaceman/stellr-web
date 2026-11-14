// @vitest-environment node
//
// Another tenant's event email carries no {{feedback_link}} while its survey is held (owner
// decision, 13 Nov 2026; lib/survey/hold.ts): eventVarsFor empties it, from the email row's
// tenant_id already in hand, and renderEventEmail leaves out the line that carries it, so
// no "Give feedback:" is left dangling. Stellr's emails, a NULL or missing tenant included,
// keep the link and render byte for byte as before.
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'

vi.mock('@/lib/community', () => ({ tiptapToPlainText: () => '', RESOURCES_BUCKET: 'community-resources' }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), EmailSendError: class extends Error {} }))
vi.mock('@/lib/docusign-reissue', () => ({ reissueParticipantAgreement: vi.fn() }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async () => null }))
vi.mock('./audiences', () => ({ resolveAudience: vi.fn() }))

const { eventVarsFor } = await import('./send')
const { eventMergeVars, omitHeldLinks, recipientMergeVars, renderEventEmail } = await import('./render')
const { markdownToTiptap } = await import('./defaults')

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const EVENT = { slug: 'colorado-space-design-challenge', title: 'Colorado Space Design Challenge', venue: 'A School' }
// eventVarsFor reads the database only for award fields, which these emails do not use.
const db = {} as SupabaseClient
const RECIPIENT = recipientMergeVars({ email: 'parent@example.test', firstName: 'Sam', roles: ['guardian'], participantNames: ['Alex'], isParticipant: false, payments: [] })

const SURVEY_URL = /\/survey\/event\/colorado-space-design-challenge/

type Doc = { type: string; content?: Doc[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] }
const text = (t: string, href?: string): Doc => ({ type: 'text', text: t, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) })
const para = (...content: Doc[]): Doc => ({ type: 'paragraph', content })
const doc = (...content: Doc[]): Doc => ({ type: 'doc', content })

async function render(tenantId: string | null | undefined, email: { subject: string; body_json: unknown }) {
  const row = tenantId === undefined ? { ...email } : { ...email, tenant_id: tenantId }
  const vars = await eventVarsFor(db, row, EVENT)
  return { vars, out: renderEventEmail(email, { ...vars, ...RECIPIENT }) }
}

const THANKS = markdownToTiptap('Thank you for coming, {{first_name}}.\n\nGive feedback: {{feedback_link}}\n\nSee you next year.')

describe('{{feedback_link}} for Stellr and for another tenant', () => {
  it("Stellr's, a NULL or missing tenant included, links the survey and renders exactly as eventMergeVars does", async () => {
    const before = renderEventEmail({ subject: 'Thanks', body_json: THANKS }, { ...eventMergeVars(EVENT), ...RECIPIENT })
    for (const tenant of [STELLR, null, undefined]) {
      const { vars, out } = await render(tenant, { subject: 'Thanks', body_json: THANKS })
      expect(vars.feedback_link, String(tenant)).toMatch(SURVEY_URL)
      expect(out, String(tenant)).toEqual(before)
      expect(out.html).toContain('Give feedback:')
    }
  })

  it("another tenant's is empty, and the line that carries it is left out of the HTML and the text", async () => {
    const { vars, out } = await render(CANARY, { subject: 'Thanks', body_json: THANKS })
    expect(vars.feedback_link).toBe('')
    for (const body of [out.html, out.text]) {
      expect(body).not.toMatch(/feedback/i)
      expect(body).not.toContain('/survey/')
      expect(body).not.toContain('{{')
      expect(body).toContain('Thank you for coming, Sam.')
      expect(body).toContain('See you next year.')
    }
    // No empty paragraph where the line was.
    expect(out.html).not.toMatch(/<p[^>]*><\/p>/)
  })

  it('takes out only the carrying line of a paragraph with line breaks', async () => {
    const body = doc(para(text('Thanks for a great day!'), { type: 'hardBreak' }, text('Tell us how it went: {{ feedback_link }}'), { type: 'hardBreak' }, text('Safe travels.')))
    const { out } = await render(CANARY, { subject: 'x', body_json: body })
    expect(out.text).toContain('Thanks for a great day!\nSafe travels.')
    expect(out.html).toContain('Thanks for a great day!<br/>Safe travels.')
    expect(out.html).not.toContain('Tell us')
  })

  it('takes out a link whose target is the field, with its words', async () => {
    const body = doc(para(text('Please ')), para(text('take the survey', '{{feedback_link}}')), para(text('Thanks!')))
    const { out } = await render(CANARY, { subject: 'x', body_json: body })
    expect(out.html).not.toContain('take the survey')
    expect(out.html).not.toContain('href=""')
    expect(out.html).toContain('Thanks!')
  })

  it('takes out a list item that carries it, and the list when nothing else is in it', async () => {
    const item = (t: string): Doc => ({ type: 'listItem', content: [para(text(t))] })
    const body = doc(
      { type: 'bulletList', content: [item('Download your certificate'), item('Feedback: {{feedback_link}}')] },
      { type: 'orderedList', content: [item('{{feedback_link}}')] },
      para(text('Bye')),
    )
    const { out } = await render(CANARY, { subject: 'x', body_json: body })
    expect(out.html).toContain('Download your certificate')
    expect(out.html).not.toContain('Feedback')
    expect(out.html).not.toContain('<ol')
    expect(out.html.match(/<li/g)).toHaveLength(1)
  })

  it('renders an email that was only the link as just the signature, and a subject that used it without the field', async () => {
    const { out } = await render(CANARY, { subject: 'Feedback {{feedback_link}} please', body_json: markdownToTiptap('{{feedback_link}}') })
    expect(out.subject).toBe('Feedback please')
    expect(out.html).not.toContain('/survey/')
    expect(out.text.trim().startsWith('All the best,')).toBe(true)
  })

  it('leaves the body object untouched when the field is not held, so Stellr never pays for the walk', () => {
    expect(omitHeldLinks(THANKS, eventMergeVars(EVENT))).toBe(THANKS)
    expect(omitHeldLinks(THANKS, { first_name: 'Sam' })).toBe(THANKS)
    // Another field rendering empty keeps the old behaviour: its line stays.
    expect(omitHeldLinks(THANKS, { ...eventMergeVars(EVENT), event_venue: '' })).toBe(THANKS)
  })
})
