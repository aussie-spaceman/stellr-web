// The four starter emails for the "Email Reminders" tab, generalised from the
// Colorado SDC emails sent by hand on 26–28 Sept 2026. Copy approved in the
// plan review; tone per VOICE.md ("Transactional emails: warm but functional").
//
// Bodies are written in a tiny markdown subset (paragraphs, "- " bullets with
// two-space nesting, **bold**) and converted to TipTap JSON, so the copy stays
// readable here and lands in the editor as normal, editable content.
// "[edit per event: …]" marks a line the author should rewrite before sending.

import type { AudienceKey } from './types'

export interface EventEmailDefault {
  key: string
  name: string
  audiences: AudienceKey[]
  subject: string
  resendDocusign: boolean
  scheduleDaysBefore: number | null
  body: string
}

export const EVENT_EMAIL_DEFAULTS: EventEmailDefault[] = [
  {
    key: 'docusign_outstanding',
    name: 'Outstanding consent form',
    audiences: ['docusign_outstanding'],
    subject: '{{event_name}} at {{event_venue}}: your consent form is still outstanding',
    resendDocusign: true,
    scheduleDaysBefore: 5,
    body: `Hi {{first_name}},

You're receiving this because {{who_is_registered}} registered for {{event_name}} at {{event_venue}} on {{event_date}}.

Our records show the consent form or agreement for this registration hasn't been completed yet. We need it signed before the event.

For a student, one form goes to their nominated parent or legal guardian and to the student, and **both** need to sign (the parent or guardian first). We've just re-sent it: look for an email from **Stellr Education** or from **@docusign.net**, and check your junk folder too.

Participants can check their status any time in the Stellr portal: {{portal_link}}

If you can't find the email, reply to this message and we'll sort it out.

Thanks for helping make {{event_name}} another great event!`,
  },
  {
    key: 'payment_outstanding',
    name: 'Outstanding payment',
    audiences: ['payment_outstanding'],
    subject: '{{event_name}} at {{event_venue}}: payment still outstanding',
    resendDocusign: false,
    scheduleDaysBefore: 5,
    body: `Hi {{first_name}},

You're receiving this because {{who_is_registered}} registered for {{event_name}} at {{event_venue}} on {{event_date}}.

We haven't received payment for this registration yet. Please complete it before the event so there are no issues on the day.

{{payment_instructions}}

Participants can also check their registration status in the Stellr portal: {{portal_link}}

If you've already paid, or have a question about the amount, reply to this message and we'll sort it out.

Thanks for helping make {{event_name}} another great event!`,
  },
  {
    key: 'one_week_to_go',
    name: 'One week to go',
    audiences: ['participants', 'guardians'],
    subject: '{{event_name}}: one week to go!',
    resendDocusign: false,
    scheduleDaysBefore: 7,
    body: `Hi {{first_name}},

You're receiving this because {{who_is_registered}} registered for {{event_name}} at {{event_venue}}, {{event_city}}, on {{event_date}}. We're excited, and we hope you are too!

Here's what you need to know:

- **Schedule:** attached. It's a draft and may change slightly this week.
- **What to expect:** for the day you're aerospace engineers. You'll form companies, receive a Request for Proposal (RFP), design a response, and pitch it to a panel of judges. [edit per event: This year's scenario is on the surface of Mars!] Expect to focus, work to a (very) tight schedule, and collaborate with students you may not normally work with.
- **What to bring:**
  - Pens and a notepad
  - A laptop or tablet if you have one. You won't be at a disadvantage without one.
  - A water bottle and snacks if you like. [edit per event: Lunch and some snacks are provided.]
- **Parents:** [edit per event: you're welcome to join us at 4pm for the presentations, or collect students at {{event_end_time}} when we finish.]

Know someone who'd enjoy it? There may still be spots available: {{event_link}}

More details will follow early next week. See you in a week!`,
  },
  {
    key: 'volunteer_briefing',
    name: 'Mentor & volunteer briefing',
    audiences: ['mentors'],
    subject: '{{event_name}} at {{event_venue}}: volunteer briefing',
    resendDocusign: false,
    scheduleDaysBefore: 7,
    body: `Hi {{first_name}},

Thank you for volunteering at {{event_name}} at {{event_venue}} on {{event_date}}. Here's what you need before the day:

- **Stellr portal:** you should have a welcome email asking you to confirm your details. Please check your profile is complete: {{portal_link}}
- **Background check:** you'll receive a separate email from **Checkr**, the service we use for background checks. Please complete it before the event. It costs you nothing.
- **Student content:** the RFP is attached, to give you an idea of what the students will be working on.
- **Schedule:** a draft schedule is attached. It may still change slightly.
- **Your role:** you're there to support the students. Guide them rather than do the work for them. Nothing technical is required; honestly, they won't have time for it.

More details will follow closer to the day. Any questions, just reply to this email.

Thanks again for giving your time!`,
  },
]

export const BLANK_DEFAULT: EventEmailDefault = {
  key: 'blank',
  name: 'New email',
  audiences: [],
  subject: '{{event_name}}: ',
  resendDocusign: false,
  scheduleDaysBefore: null,
  body: 'Hi {{first_name}},\n\n',
}

// ── mini-markdown → TipTap JSON ───────────────────────────────────────────────

type TNode = { type: string; text?: string; marks?: { type: string }[]; content?: TNode[]; attrs?: Record<string, unknown> }

function inline(text: string): TNode[] {
  const out: TNode[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      out.push({ type: 'text', text: part.slice(2, -2), marks: [{ type: 'bold' }] })
    } else {
      out.push({ type: 'text', text: part })
    }
  }
  return out
}

function paragraph(text: string): TNode {
  const content = inline(text)
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

/** Convert the markdown subset above into a TipTap document. */
export function markdownToTiptap(src: string): { type: 'doc'; content: TNode[] } {
  const content: TNode[] = []
  for (const block of src.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.length > 0)
    if (lines.length === 0) continue
    if (!lines.every((l) => /^\s*- /.test(l))) {
      content.push(paragraph(lines.join(' ')))
      continue
    }
    // Bullet list, one level of nesting (two-space indent).
    const top: TNode = { type: 'bulletList', content: [] }
    for (const line of lines) {
      const nested = /^\s{2,}- /.test(line)
      const item: TNode = { type: 'listItem', content: [paragraph(line.replace(/^\s*- /, ''))] }
      const parent = top.content![top.content!.length - 1]
      if (nested && parent) {
        let sub = parent.content!.find((c) => c.type === 'bulletList')
        if (!sub) {
          sub = { type: 'bulletList', content: [] }
          parent.content!.push(sub)
        }
        sub.content!.push(item)
      } else {
        top.content!.push(item)
      }
    }
    content.push(top)
  }
  return { type: 'doc', content }
}
