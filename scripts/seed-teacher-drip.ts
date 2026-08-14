#!/usr/bin/env npx tsx
/**
 * Create the teacher welcome drip: three campaigns bound to the 'member.created'
 * event at 5, 14 and 23 days.
 *
 * Email 1 of the four in the brief is NOT here. It fires immediately on account
 * creation and is sent transactionally by lib/registration-notify.ts, so that a
 * member who has opted out of marketing still learns their account exists —
 * resolveAudience suppresses on marketing_consent, which is right for the drip
 * and wrong for a confirmation. Adding a delay-0 campaign for it would send
 * every new teacher two welcomes.
 *
 * Doing this in a script rather than by hand in /admin/email is deliberate.
 * substituteTokens THROWS on an unknown {{token}}, and it throws at render time,
 * not at save time — so one stray token typed into the editor saves cleanly and
 * then breaks every send for that campaign. Here the bodies are literal and the
 * only tokens used are ones lib/email-vars.ts resolves.
 *
 * Campaigns are created as DRAFT. Drafts never fire — fireCampaignEvent only
 * matches status='scheduled'. Send yourself a Test from /admin/email, then
 * Activate all three together (or pass --activate here) so a teacher registering
 * mid-way can't get a partial sequence.
 *
 * Idempotent, and safe to re-run while iterating on copy: existing templates are
 * UPDATED in place (matched by key), and any teacher-welcome campaign no longer
 * in the set below is archived.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   pointing at the target environment, and migration 136 applied there.
 *
 * Run:
 *   npx tsx scripts/seed-teacher-drip.ts --preview   # write HTML previews, touch nothing
 *   npx tsx scripts/seed-teacher-drip.ts             # dry run — print the plan
 *   npx tsx scripts/seed-teacher-drip.ts --apply     # create/update as drafts
 *   npx tsx scripts/seed-teacher-drip.ts --apply --activate   # and arm them
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { renderCampaignEmail } from '../lib/email-render'
import { memberMergeVars } from '../lib/email-vars'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const APPLY = process.argv.includes('--apply')
const ACTIVATE = process.argv.includes('--activate')
const PREVIEW = process.argv.includes('--preview')

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const SEQUENCE = 'teacher-welcome'
const EVENT_KEY = 'member.created'
const TIER_NAME = 'Educator'

const LINKS = {
  curriculum: `${WWW}/curriculum`,
  events: `${WWW}/events`,
  membership: `${WWW}/membership`,
  educators: `${WWW}/educators`,
  linkedin: 'https://www.linkedin.com/company/stellreducation/',
  facebook: 'https://www.facebook.com/stellreducation',
}

// ── Tiptap doc helpers ───────────────────────────────────────────────────────
// The admin editor stores Tiptap JSON and lib/email-render walks it, so building
// the same shape here keeps these templates editable in the UI afterwards.

type Node = Record<string, unknown>

const text = (s: string): Node => ({ type: 'text', text: s })
const bold = (s: string): Node => ({ type: 'text', text: s, marks: [{ type: 'bold' }] })
const link = (s: string, href: string): Node => ({
  type: 'text', text: s, marks: [{ type: 'link', attrs: { href } }],
})
const p = (...content: Node[]): Node => ({ type: 'paragraph', content })
const doc = (...content: Node[]): Node => ({ type: 'doc', content })

/** House sign-off, as plain paragraphs so it stays editable in the admin editor. */
const SIGN_OFF_LINES = 4
const signOff = (): Node[] => [
  p(text('All the best,')),
  p(bold('David Shaw')),
  p(text('Founder + Chief Inspiration Officer')),
  p(text('Stellr Education')),
]

interface Step {
  key: string
  name: string
  subject: string
  delayDays: number
  body: Node
}

// Only {{firstName}} is used. lib/email-vars.ts also resolves lastName, fullName,
// email, membershipId, tier and unsubscribeUrl — anything else throws at render.
const STEPS: Step[] = [
  {
    key: 'teacher-welcome-day-5',
    name: 'Teacher welcome — day 5',
    subject: 'Stellr Competitions: In-Person Challenge or Remote Campaigns?',
    delayDays: 5,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text('Stellr Competitions are how we provide career trajectory support for high school students – and there are two ways for your students to participate:')),
      p(bold('Challenges'), text(' are in-person events, held across the country. Teams work in large groups under strict time constraints and present before judges. All you have to do is get students there – we do the rest.')),
      p(bold('Campaigns'), text(' take the same competition material but are delivered remotely — you get the full package and run it in your own classroom, on your own timetable. We even provide recommended schedules covering 4-weeks through 16-weeks.')),
      p(text('The biggest differentiators are generally geography – are we running a Challenge near you? – and then time – does it fit into your calendar?')),
      p(link('See the curriculum', LINKS.curriculum), text('  ·  '), link('Find an event', LINKS.events)),
      ...signOff(),
    ),
  },
  {
    key: 'teacher-welcome-day-14',
    name: 'Teacher welcome — day 14',
    subject: 'Stellr Community – The More The Merrier',
    delayDays: 14,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text('The Stellr Community has been built to support our teachers (as well as our student participants) – we’re building a global cohort of the best STEM educators, and you’re now a part of that.')),
      p(text('We also offer much more than our freemium Educator tier – more support for you (so you can support your students), group mentoring sessions, and CTE credits (state dependent).')),
      p(text('And don’t forget to share - if a colleague would benefit from joining the Stellr Community, please forward them this email. And make sure you keep in the loop via '), link('LinkedIn', LINKS.linkedin), text(' and '), link('Facebook', LINKS.facebook), text('.')),
      p(link('Compare membership tiers', LINKS.membership)),
      ...signOff(),
    ),
  },
  {
    key: 'teacher-welcome-day-23',
    name: 'Teacher welcome — day 23',
    subject: 'The Stellr Academy – Training, Mentoring, and Coaching – Made For Teachers Like You',
    delayDays: 23,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text('The Stellr Academy is our training arm: professional development for you, group mentoring for your students, and one-on-one coaching where it is needed.')),
      p(text('Pricing varies based on how many sessions you join, your Educator membership automatically gives you 5% off, and if you upgrade your membership mentoring is included.')),
      p(text('Not sure what might work for you? Get in touch – we’re here to help.')),
      p(link("See what's available for educators", LINKS.educators)),
      ...signOff(),
    ),
  },
]

/** Body words, excluding the greeting, the link line and the sign-off. */
function bodyWordCount(step: Step): number {
  const content = (step.body.content as Node[]) ?? []
  const paras = content.slice(1, content.length - (SIGN_OFF_LINES + 1))
  return paras
    .flatMap((n) => ((n.content as Node[]) ?? []).map((c) => String(c.text ?? '')))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
}

function writePreviews() {
  const outDir = '/tmp/stellr-drip-preview'
  fs.mkdirSync(outDir, { recursive: true })
  const unsub = 'https://app.stellreducation.org/api/email/unsubscribe?token=preview'
  const vars = memberMergeVars(
    {
      id: 'preview', first_name: 'Michelle', last_name: 'Matlock',
      email: 'preview@example.org', membership_id: '0000127', tier_name: TIER_NAME,
    },
    unsub,
  )
  for (const step of STEPS) {
    const r = renderCampaignEmail(
      { name: step.name, subject: step.subject, body_json: step.body },
      vars,
      unsub,
    )
    const file = path.join(outDir, `${step.key}.html`)
    fs.writeFileSync(file, `<div style="background:#edf1fb">${r.html}</div>`)
    console.log(`\n── ${step.name}  (+${step.delayDays}d · ${bodyWordCount(step)} body words)`)
    console.log(`   Subject: ${step.subject}`)
    console.log(`   Preview: ${file}`)
  }
  console.log('')
}

async function main() {
  if (PREVIEW) {
    console.log('\nTeacher welcome drip — PREVIEW (nothing written)')
    writePreviews()
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
    process.exit(1)
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  console.log(`\nTeacher welcome drip — ${APPLY ? 'APPLY' : 'DRY RUN'}${ACTIVATE ? ' + ACTIVATE' : ''}`)
  console.log(`Target: ${url}`)
  console.log(`Links:  ${WWW}\n`)

  // Migration 136 must be applied, or delay_days silently doesn't exist and every
  // step would send immediately.
  const { error: colErr } = await db.from('email_campaigns').select('delay_days').limit(1)
  if (colErr) {
    console.error('email_campaigns.delay_days is missing — apply migration 136 first.')
    console.error(colErr.message)
    process.exit(1)
  }

  // Audience: Educator tier only, so the sequence never reaches students or parents.
  const { data: tier } = await db
    .from('membership_tiers')
    .select('id, name')
    .eq('name', TIER_NAME)
    .maybeSingle()
  if (!tier) {
    console.error(`No membership tier named "${TIER_NAME}" — cannot scope the audience.`)
    process.exit(1)
  }
  const audience = { activeOnly: true, excludeMinors: true, tierIds: [tier.id as string] }
  console.log(`Audience: ${TIER_NAME} tier (${tier.id}), active only, minors excluded\n`)

  const wantedNames = new Set(STEPS.map((s) => s.name))

  for (const step of STEPS) {
    // ── template: updated in place so re-running iterates on copy ──
    const { data: existingTpl } = await db
      .from('email_templates')
      .select('id')
      .eq('key', step.key)
      .maybeSingle()

    let templateId = (existingTpl as { id: string } | null)?.id ?? null
    const tplFields = { name: step.name, subject: step.subject, body_json: step.body, is_archived: false }

    if (templateId) {
      if (APPLY) {
        const { error } = await db.from('email_templates').update(tplFields).eq('id', templateId)
        if (error) throw new Error(`template ${step.key}: ${error.message}`)
      }
      console.log(`  template  ${step.key.padEnd(24)} ${APPLY ? 'updated' : 'would update'}`)
    } else if (APPLY) {
      const { data, error } = await db
        .from('email_templates')
        .insert({ key: step.key, ...tplFields })
        .select('id')
        .single()
      if (error) throw new Error(`template ${step.key}: ${error.message}`)
      templateId = data.id
      console.log(`  template  ${step.key.padEnd(24)} created`)
    } else {
      console.log(`  template  ${step.key.padEnd(24)} would create — "${step.subject}"`)
    }

    // ── campaign ──
    const { data: existingCmp } = await db
      .from('email_campaigns')
      .select('id, status')
      .eq('name', step.name)
      .maybeSingle()

    if (existingCmp) {
      const status = (existingCmp as { status: string }).status
      // Never resurrect a campaign an admin paused or archived — only refresh the
      // fields that describe it.
      if (APPLY) {
        const { error } = await db
          .from('email_campaigns')
          .update({ delay_days: step.delayDays, sequence_key: SEQUENCE, audience, template_id: templateId })
          .eq('id', (existingCmp as { id: string }).id)
        if (error) throw new Error(`campaign ${step.name}: ${error.message}`)
      }
      console.log(`  campaign  ${step.name.padEnd(26)} ${APPLY ? 'updated' : 'would update'} (${status})`)
    } else if (APPLY && templateId) {
      const { error } = await db.from('email_campaigns').insert({
        name: step.name,
        template_id: templateId,
        trigger_type: 'event',
        event_key: EVENT_KEY,
        delay_days: step.delayDays,
        sequence_key: SEQUENCE,
        audience,
        status: ACTIVATE ? 'scheduled' : 'draft',
      })
      if (error) throw new Error(`campaign ${step.name}: ${error.message}`)
      console.log(`  campaign  ${step.name.padEnd(26)} created (+${step.delayDays}d, ${ACTIVATE ? 'ACTIVE' : 'draft'})`)
    } else if (!APPLY) {
      console.log(`  campaign  ${step.name.padEnd(26)} would create — ${EVENT_KEY} +${step.delayDays}d`)
    }
    console.log('')
  }

  // ── retire superseded steps (the earlier 2/7/30-day drafts) ──
  const { data: stale } = await db
    .from('email_campaigns')
    .select('id, name, status')
    .eq('sequence_key', SEQUENCE)
    .neq('status', 'archived')

  for (const c of stale ?? []) {
    if (wantedNames.has(c.name as string)) continue
    if (APPLY) await db.from('email_campaigns').update({ status: 'archived' }).eq('id', c.id)
    console.log(`  ${APPLY ? 'archived' : 'would archive'} superseded campaign: ${c.name}`)
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply.\n')
    return
  }

  const { data: final } = await db
    .from('email_campaigns')
    .select('name, delay_days, status')
    .eq('sequence_key', SEQUENCE)
    .neq('status', 'archived')
    .order('delay_days', { ascending: true })

  console.log('\nSequence now:')
  for (const c of final ?? []) {
    console.log(`  +${String(c.delay_days).padStart(2)}d  ${String(c.name).padEnd(28)} ${c.status}`)
  }

  if (!ACTIVATE) {
    console.log('\nAll DRAFT and will not fire. In /admin/email: send yourself a Test on each,')
    console.log('then Activate them together.\n')
  } else {
    console.log('\nARMED. The next teacher to complete onboarding starts the sequence.\n')
  }
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
