#!/usr/bin/env npx tsx
/**
 * Create the teacher welcome drip: four templates and four campaigns bound to
 * the 'member.created' event at 2, 7, 14 and 30 days.
 *
 * Doing this in a script rather than by hand in /admin/email is deliberate.
 * Authoring eight objects through the UI means retyping bodies that contain
 * links and merge fields, and substituteTokens THROWS on an unknown {{token}} —
 * so one stray token silently breaks every send for that campaign at render
 * time, not at save time. Here the bodies are literal, the URLs are real, and
 * the only tokens used are ones lib/email-vars.ts actually resolves.
 *
 * Campaigns are created as DRAFT. Drafts never fire — fireCampaignEvent only
 * matches status='scheduled'. Send yourself a Test from /admin/email, then
 * Activate all four together (or pass --activate here) so a teacher registering
 * mid-way can't get a partial sequence.
 *
 * Idempotent: templates are matched by key and campaigns by name, so re-running
 * skips whatever already exists and only creates the rest.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   pointing at the target environment, and migration 136 applied there.
 *
 * Run:
 *   npx tsx scripts/seed-teacher-drip.ts             # dry run — prints the plan
 *   npx tsx scripts/seed-teacher-drip.ts --apply     # create as drafts
 *   npx tsx scripts/seed-teacher-drip.ts --apply --activate   # create and arm
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
  process.exit(1)
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } })

const APPLY = process.argv.includes('--apply')
const ACTIVATE = process.argv.includes('--activate')

const APP = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'
const SEQUENCE = 'teacher-welcome'
const EVENT_KEY = 'member.created'
const TIER_NAME = 'Educator'

// ── Tiptap doc helpers ───────────────────────────────────────────────────────
// The admin editor stores Tiptap JSON and lib/email-render walks it. Building
// the same shape here keeps these templates editable in the UI afterwards.

type Node = Record<string, unknown>

const text = (s: string): Node => ({ type: 'text', text: s })
const bold = (s: string): Node => ({ type: 'text', text: s, marks: [{ type: 'bold' }] })
const link = (s: string, href: string): Node => ({
  type: 'text', text: s, marks: [{ type: 'link', attrs: { href } }],
})
const p = (...content: Node[]): Node => ({ type: 'paragraph', content })
const doc = (...content: Node[]): Node => ({ type: 'doc', content })

interface Step {
  key: string
  name: string
  subject: string
  delayDays: number
  body: Node
}

// Only {{firstName}} is used. lib/email-vars.ts also resolves lastName,
// fullName, email, membershipId, tier and unsubscribeUrl — anything else throws
// at render time.
const STEPS: Step[] = [
  {
    key: 'teacher-welcome-day-2',
    name: 'Teacher welcome — day 2',
    subject: 'What your Educator membership already opens',
    delayDays: 2,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text('Your Educator membership is active, so everything below is already unlocked — there is nothing to activate or upgrade.')),
      p(bold('The Educator Tier Space'), text(' is where the classroom-ready material lives: lesson plans, student worksheets, and the slide decks we use at our own events. Most of it is built to drop into a single period without prep.')),
      p(bold("The Teachers' Room"), text(' is the staff-room equivalent — other educators running the same programs, plus our team when you need an answer from us.')),
      p(link('Open your Spaces', `${APP}/spaces`)),
      p(text("If something you expected to see isn't there, reply and tell us. We'd rather hear it early.")),
      p(text('— The Stellr team')),
    ),
  },
  {
    key: 'teacher-welcome-day-7',
    name: 'Teacher welcome — day 7',
    subject: 'Our competition calendar, and how teachers usually start',
    delayDays: 7,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text("Most teachers start with one competition rather than a whole program, so here's the calendar and roughly what each one asks of you.")),
      p(text('Space Design Challenges run as one-day team events — students design a settlement against a real engineering brief, and you supervise rather than teach. Teams are typically 6–12 students, and no prior aerospace knowledge is needed on your side or theirs.')),
      p(link("See what's open", `${APP}/events`)),
      p(text("If you're weighing whether a particular event fits your cohort, reply with the year level and how many students you're thinking of. We'll tell you straight whether it's a good match.")),
      p(text('— The Stellr team')),
    ),
  },
  {
    key: 'teacher-welcome-day-14',
    name: 'Teacher welcome — day 14',
    subject: 'Registering a group takes about ten minutes',
    delayDays: 14,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text("When you're ready to bring students, the group registration flow is built so you don't have to chase individual sign-ups.")),
      p(text('You register the group, then send your students a single join link. They complete their own details and consent forms; you see who has and hasn’t finished from one page. Schools that need an invoice rather than a card payment can choose that at checkout.')),
      p(link('Start a group registration', `${APP}/events`)),
      p(text("Two things worth knowing up front: students under 18 need a parent or guardian to complete the consent step, and you can add students after you register — the group isn't locked once created.")),
      p(text('— The Stellr team')),
    ),
  },
  {
    key: 'teacher-welcome-day-30',
    name: 'Teacher welcome — day 30',
    subject: 'The people behind the resources',
    delayDays: 30,
    body: doc(
      p(text('Hi {{firstName}},')),
      p(text("A month in — here's the part of Stellr that isn't a download.")),
      p(text('The '), bold("Teachers' Room"), text(' is where educators compare notes on what actually worked with a class, which is usually more useful than our own documentation. Our '), bold('mentors'), text(' are working engineers and scientists who join sessions to answer student questions directly; you can request one for your classroom.')),
      p(text('We also run live sessions through the year — some for students, some for teachers on running these programs.')),
      p(link("What's coming up", `${APP}/spaces`)),
      p(text("And if Stellr hasn't been useful so far, reply and tell us why. That's more valuable to us than a quiet unsubscribe.")),
      p(text('— The Stellr team')),
    ),
  },
]

async function main() {
  console.log(`\nTeacher welcome drip — ${APPLY ? 'APPLY' : 'DRY RUN'}${ACTIVATE ? ' + ACTIVATE' : ''}`)
  console.log(`Target: ${url}`)
  console.log(`Links:  ${APP}\n`)

  // Migration 136 must be applied, or delay_days silently doesn't exist and
  // every step would send immediately.
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

  for (const step of STEPS) {
    // ── template ──
    const { data: existingTpl } = await db
      .from('email_templates')
      .select('id')
      .eq('key', step.key)
      .maybeSingle()

    let templateId = (existingTpl as { id: string } | null)?.id ?? null
    if (templateId) {
      console.log(`  template  ${step.key.padEnd(24)} exists — skipped`)
    } else if (APPLY) {
      const { data, error } = await db
        .from('email_templates')
        .insert({ key: step.key, name: step.name, subject: step.subject, body_json: step.body })
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
      console.log(`  campaign  ${step.name.padEnd(24)} exists (${(existingCmp as { status: string }).status}) — skipped`)
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
      console.log(`  campaign  ${step.name.padEnd(24)} created (+${step.delayDays}d, ${ACTIVATE ? 'ACTIVE' : 'draft'})`)
    } else if (!APPLY) {
      console.log(`  campaign  ${step.name.padEnd(24)} would create — ${EVENT_KEY} +${step.delayDays}d`)
    }
    console.log('')
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.\n')
    return
  }

  const { data: final } = await db
    .from('email_campaigns')
    .select('name, delay_days, status')
    .eq('sequence_key', SEQUENCE)
    .order('delay_days', { ascending: true })

  console.log('Sequence now:')
  for (const c of final ?? []) {
    console.log(`  +${String(c.delay_days).padStart(2)}d  ${String(c.name).padEnd(26)} ${c.status}`)
  }

  if (!ACTIVATE) {
    console.log('\nAll four are DRAFT and will not fire. In /admin/email: send yourself a Test')
    console.log('on each, then Activate all four together.\n')
  } else {
    console.log('\nAll four are ARMED. The next teacher to complete onboarding starts the sequence.\n')
  }
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
