#!/usr/bin/env npx tsx
/**
 * Create the membership welcome drips: for each tier FAMILY, three marketing
 * campaigns bound to the 'member.created' event at 5, 14 and 23 days.
 *
 * Families mirror lib/tiers.ts TIER_GROUPS:
 *   teacher      Educator · Catalyst · Innovator · Trailblazer
 *   high_school  Explorer · Pathfinder · Scholar
 *   college      Alumni   · Contributor · Counselor
 *
 * V1 deliberately sends ONE sequence per family rather than per tier. Audience is
 * re-resolved at send time against the member's CURRENT tier, so a per-tier
 * sequence would break the moment someone upgraded mid-drip: they would drop out
 * of the tier they started on and pick up a half-finished sequence for the new
 * one. Scoping to the family makes an in-family upgrade a non-event. Splitting
 * further later is an addition, not a rewrite — add a family entry and re-run.
 *
 * Email 1 of the four in the brief is NOT here. It fires immediately on account
 * creation and is sent transactionally by lib/registration-notify.ts, so that a
 * member who has opted out of marketing still learns their account exists —
 * resolveAudience suppresses on marketing_consent, which is right for the drip
 * and wrong for a confirmation. Adding a delay-0 campaign for it would send
 * every new member two welcomes. Its per-family body copy lives in
 * registration-notify.ts, keyed off the same TIER_GROUPS.
 *
 * ⚠ MINORS. lib/email-campaigns.ts treats age_bracket='high_school' as a minor
 * and `excludeMinors: true` drops them from every audience — a deliberate "school
 * students are never marketed to" decision. The high_school family below
 * therefore sets excludeMinors: FALSE; with it true the sequence would resolve to
 * zero recipients and send nothing, silently. That flip is a policy call, not a
 * technical one — see docs/RUNBOOK-tier-welcome-drips.md before activating.
 *
 * Doing this in a script rather than by hand in /admin/email is deliberate.
 * substituteTokens THROWS on an unknown {{token}}, and it throws at render time,
 * not at save time — so one stray token typed into the editor saves cleanly and
 * then breaks every send for that campaign. Here the bodies are literal and the
 * only token used is {{firstName}}, which lib/email-vars.ts always resolves (it
 * falls back to "there"). {{tier}} is avoided on purpose: tier_name is
 * best-effort in resolveAudience and renders as "Your  membership" when it comes
 * back null.
 *
 * Campaigns are created as DRAFT. Drafts never fire — fireCampaignEvent only
 * matches status='scheduled'. Send yourself a Test from /admin/email, then
 * Activate a family's three together (or pass --activate here) so a member
 * registering mid-way can't get a partial sequence.
 *
 * Idempotent, and safe to re-run while iterating on copy: existing templates are
 * UPDATED in place (matched by key), and any campaign in a seeded family's
 * sequence that is no longer in the set below is archived.
 *
 * Prerequisites:
 *   .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   pointing at the target environment, and migration 136 applied there.
 *
 * Run:
 *   npx tsx scripts/seed-welcome-drips.ts --preview            # write HTML previews, touch nothing
 *   npx tsx scripts/seed-welcome-drips.ts                      # dry run — print the plan
 *   npx tsx scripts/seed-welcome-drips.ts --apply              # create/update as drafts
 *   npx tsx scripts/seed-welcome-drips.ts --apply --activate   # and arm them
 *   npx tsx scripts/seed-welcome-drips.ts --family=college ... # one family only
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { renderCampaignEmail } from '../lib/email-render'
import { memberMergeVars } from '../lib/email-vars'
import { TIER_GROUPS, type TierGroupKey } from '../lib/tiers'

// ── env ──────────────────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

const APPLY = process.argv.includes('--apply')
const ACTIVATE = process.argv.includes('--activate')
const PREVIEW = process.argv.includes('--preview')
const FAMILY_ARG = process.argv.find((a) => a.startsWith('--family='))?.split('=')[1]

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
const EVENT_KEY = 'member.created'

const LINKS = {
  academy: `${WWW}/academy`,
  competitions: `${WWW}/competitions`,
  curriculum: `${WWW}/curriculum`,
  educators: `${WWW}/educators`,
  events: `${WWW}/events`,
  membership: `${WWW}/membership`,
  mentors: `${WWW}/mentors`,
  network: `${WWW}/network`,
  scholarship: `${WWW}/scholarship`,
  facebook: 'https://www.facebook.com/stellreducation',
  instagram: 'https://www.instagram.com/stellreducation/',
  linkedin: 'https://www.linkedin.com/company/stellreducation/',
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
  /** email_templates.key — the idempotency handle. */
  key: string
  name: string
  subject: string
  delayDays: number
  body: Node
}

interface Family {
  key: TierGroupKey
  label: string
  sequenceKey: string
  /**
   * false only for high_school. See the MINORS note in the file header — with
   * true the family's audience resolves empty and the drip sends nothing at all.
   */
  excludeMinors: boolean
  steps: Step[]
}

/** Tier names per family come from lib/tiers.ts so the two can't drift. */
function tierNamesFor(key: TierGroupKey): string[] {
  const group = TIER_GROUPS.find((g) => g.key === key)
  if (!group) throw new Error(`no TIER_GROUPS entry for "${key}"`)
  return group.tierNames
}

// ─── Teacher (unchanged — already reviewed) ──────────────────────────────────

const TEACHER: Family = {
  key: 'teacher',
  label: 'Teacher',
  sequenceKey: 'teacher-welcome',
  excludeMinors: true,
  steps: [
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
  ],
}

// ─── High school (Explorer · Pathfinder · Scholar) ───────────────────────────
//
// Audience is 14–18. VOICE.md: concrete examples, things you'll actually do, no
// talking down, and no "exciting opportunities". Email 4 mentions money, so it
// points at the scholarship and says to check with a parent or guardian first.

const HIGH_SCHOOL: Family = {
  key: 'high_school',
  label: 'High School',
  sequenceKey: 'high-school-welcome',
  excludeMinors: false, // see the MINORS note in the file header
  steps: [
    {
      key: 'hs-welcome-day-5',
      name: 'High school welcome — day 5',
      subject: 'Two ways to enter a Stellr Competition',
      delayDays: 5,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('A Stellr Competition is an industry simulation. You get a themed brief — a real engineering problem — form a team, and present your design to judges who do this for a living. There are two ways in.')),
        p(bold('Challenges'), text(' are in-person events, run across the country. You work in a team under time pressure and present at the end of the day. Turn up; we run the rest.')),
        p(bold('Campaigns'), text(' use the same material, delivered remotely through your school. Your teacher runs it on your timetable — anywhere from 4 to 16 weeks.')),
        p(text('You do not need to know any engineering to start. That is what the brief and the training material in your portal are for.')),
        p(link('How Competitions work', LINKS.competitions), text('  ·  '), link('Find an event', LINKS.events)),
        ...signOff(),
      ),
    },
    {
      key: 'hs-welcome-day-14',
      name: 'High school welcome — day 14',
      subject: 'The Stellr Community — and why you should bring a friend',
      delayDays: 14,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('Your membership is more than the Competitions. The Stellr Community is students in the same position as you, all over the world, plus the mentors, engineers and teachers who help them.')),
        p(text('In the portal you can ask questions, see what other teams have built, and get answers from people who do this work. Nobody there thinks a beginner question is a bad one — that is the whole point of it.')),
        p(text('Two things worth doing this week: introduce yourself in your Space, and forward this email to a friend who would get something out of it. Membership starts free.')),
        p(text('You can also keep up with us on '), link('Instagram', LINKS.instagram), text(', '), link('LinkedIn', LINKS.linkedin), text(' and '), link('Facebook', LINKS.facebook), text('.')),
        p(link('Compare membership tiers', LINKS.membership)),
        ...signOff(),
      ),
    },
    {
      key: 'hs-welcome-day-23',
      name: 'High school welcome — day 23',
      subject: 'The Stellr Academy — training, mentoring and coaching',
      delayDays: 23,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('The Stellr Academy is the training side of Stellr: self-paced courses that get you ready for a Competition, group mentoring, and one-to-one coaching when you want it.')),
        p(text('Your membership already includes a discount on Academy sessions, and upgrading to Pathfinder or Scholar includes mentoring rather than charging for it.')),
        p(text('If cost is the obstacle, apply for a scholarship — we cover the participation fee for the competition or workshop you are applying to. And check with a parent or guardian before paying for anything.')),
        p(text('Not sure what fits? Reply to this email and we will help you work it out.')),
        p(link('See the Academy', LINKS.academy), text('  ·  '), link('Apply for a scholarship', LINKS.scholarship), text('  ·  '), link('Compare tiers', LINKS.membership)),
        ...signOff(),
      ),
    },
  ],
}

// ─── College (Alumni · Contributor · Counselor) ──────────────────────────────
//
// VOICE.md: respect their time, give adult-life context, no pity framing. The
// differentiator versus high school is that college members can MENTOR — and
// mentoring at an event is what the "Mentor at event → Contributor (1yr)" grant
// rule already pays out, so email 2 is where that belongs.

const COLLEGE: Family = {
  key: 'college',
  label: 'College',
  sequenceKey: 'college-welcome',
  excludeMinors: true,
  steps: [
    {
      key: 'college-welcome-day-5',
      name: 'College welcome — day 5',
      subject: 'Two ways to take part — and one way to lead',
      delayDays: 5,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('A Stellr Competition is an industry simulation: a themed brief setting a real engineering problem, a team, and a design presented to judges who do this professionally.')),
        p(bold('Challenges'), text(' are in-person, single-day events run across the country. '), bold('Campaigns'), text(' use the same material remotely, over 4 to 16 weeks.')),
        p(text('There is also a third route, and it is the one specific to you: mentor a high school team. It costs you a day, it is concrete evidence of leadership on a résumé, and mentoring at an event earns you a year of Contributor membership at no cost.')),
        p(link('Find an event', LINKS.events), text('  ·  '), link('Volunteer as a mentor', LINKS.mentors)),
        ...signOff(),
      ),
    },
    {
      key: 'college-welcome-day-14',
      name: 'College welcome — day 14',
      subject: 'The people are the point',
      delayDays: 14,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('The Stellr Community is where a membership compounds. The member directory, the chat, and the Stellr Network — the universities, providers and employers who work with us — all sit in your portal.')),
        p(text('Two things worth ten minutes this week: introduce yourself in your Space, and fill out your profile so mentors and Network partners can see what you are working toward. A blank profile is a missed introduction.')),
        p(text('If someone in your cohort would use this, forward them this email — Alumni membership is free. And keep in the loop via '), link('LinkedIn', LINKS.linkedin), text(' and '), link('Instagram', LINKS.instagram), text('.')),
        p(link('Explore the Network', LINKS.network), text('  ·  '), link('Compare membership tiers', LINKS.membership)),
        ...signOff(),
      ),
    },
    {
      key: 'college-welcome-day-23',
      name: 'College welcome — day 23',
      subject: 'The Stellr Academy — and what upgrading actually gets you',
      delayDays: 23,
      body: doc(
        p(text('Hi {{firstName}},')),
        p(text('The Stellr Academy covers Competition training, hands-on career preparation, and the STEM Power Skills — communicating under pressure, working in a team that did not pick itself, presenting to a room — that degrees rarely teach and employers keep asking about.')),
        p(text('Sessions are priced individually and your membership includes a discount. Contributor and Counselor include mentoring rather than charging for it, which is usually the point at which upgrading pays for itself.')),
        p(text('Not sure which is right? Reply to this email. We would rather point you at the right thing than sell you the wrong one.')),
        p(link('See the Academy', LINKS.academy), text('  ·  '), link('Compare membership tiers', LINKS.membership)),
        ...signOff(),
      ),
    },
  ],
}

const FAMILIES: Family[] = [TEACHER, HIGH_SCHOOL, COLLEGE]

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

function selectedFamilies(): Family[] {
  if (!FAMILY_ARG) return FAMILIES
  const wanted = FAMILY_ARG.replace(/-/g, '_')
  const hit = FAMILIES.filter((f) => f.key === wanted)
  if (!hit.length) {
    console.error(`Unknown --family="${FAMILY_ARG}". Use one of: ${FAMILIES.map((f) => f.key).join(', ')}`)
    process.exit(1)
  }
  return hit
}

function writePreviews(families: Family[]) {
  const outDir = '/tmp/stellr-drip-preview'
  fs.mkdirSync(outDir, { recursive: true })
  const unsub = 'https://app.stellreducation.org/api/email/unsubscribe?token=preview'
  for (const family of families) {
    const vars = memberMergeVars(
      {
        id: 'preview', first_name: 'Michelle', last_name: 'Matlock',
        email: 'preview@example.org', membership_id: '0000127',
        tier_name: tierNamesFor(family.key)[0],
      },
      unsub,
    )
    console.log(`\n═══ ${family.label} (${family.sequenceKey})`)
    for (const step of family.steps) {
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
  }
  console.log('')
}

async function main() {
  const families = selectedFamilies()

  if (PREVIEW) {
    console.log('\nMembership welcome drips — PREVIEW (nothing written)')
    writePreviews(families)
    return
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local).')
    process.exit(1)
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  console.log(`\nMembership welcome drips — ${APPLY ? 'APPLY' : 'DRY RUN'}${ACTIVATE ? ' + ACTIVATE' : ''}`)
  console.log(`Target:   ${url}`)
  console.log(`Links:    ${WWW}`)
  console.log(`Families: ${families.map((f) => f.key).join(', ')}\n`)

  // Migration 136 must be applied, or delay_days silently doesn't exist and every
  // step would send immediately.
  const { error: colErr } = await db.from('email_campaigns').select('delay_days').limit(1)
  if (colErr) {
    console.error('email_campaigns.delay_days is missing — apply migration 136 first.')
    console.error(colErr.message)
    process.exit(1)
  }

  // Resolve every tier name up front, so a rename fails loudly here rather than
  // producing a campaign with an empty tierIds filter — which resolveAudience
  // treats as "all tiers", i.e. the sequence would go to everyone.
  const { data: tierRows } = await db.from('membership_tiers').select('id, name')
  const idByName = new Map((tierRows ?? []).map((t) => [t.name as string, t.id as string]))

  for (const family of families) {
    const names = tierNamesFor(family.key)
    const missing = names.filter((n) => !idByName.has(n))
    if (missing.length) {
      console.error(`Family "${family.key}": no membership tier named ${missing.join(', ')} — cannot scope the audience.`)
      process.exit(1)
    }
    const tierIds = names.map((n) => idByName.get(n)!)
    const audience = { activeOnly: true, excludeMinors: family.excludeMinors, tierIds }

    console.log(`═══ ${family.label} — sequence "${family.sequenceKey}"`)
    console.log(`    Audience: ${names.join(', ')} · active only · minors ${family.excludeMinors ? 'EXCLUDED' : 'INCLUDED'}`)
    if (!family.excludeMinors) {
      console.log('    ⚠ This sequence WILL mail members under 18. Confirm the policy before --activate.')
    }
    console.log('')

    const wantedNames = new Set(family.steps.map((s) => s.name))

    for (const step of family.steps) {
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
            .update({ delay_days: step.delayDays, sequence_key: family.sequenceKey, audience, template_id: templateId })
            .eq('id', (existingCmp as { id: string }).id)
          if (error) throw new Error(`campaign ${step.name}: ${error.message}`)
        }
        console.log(`  campaign  ${step.name.padEnd(30)} ${APPLY ? 'updated' : 'would update'} (${status})`)
      } else if (APPLY && templateId) {
        const { error } = await db.from('email_campaigns').insert({
          name: step.name,
          template_id: templateId,
          trigger_type: 'event',
          event_key: EVENT_KEY,
          delay_days: step.delayDays,
          sequence_key: family.sequenceKey,
          audience,
          status: ACTIVATE ? 'scheduled' : 'draft',
        })
        if (error) throw new Error(`campaign ${step.name}: ${error.message}`)
        console.log(`  campaign  ${step.name.padEnd(30)} created (+${step.delayDays}d, ${ACTIVATE ? 'ACTIVE' : 'draft'})`)
      } else if (!APPLY) {
        console.log(`  campaign  ${step.name.padEnd(30)} would create — ${EVENT_KEY} +${step.delayDays}d`)
      }
      console.log('')
    }

    // ── retire superseded steps within THIS family only ──
    const { data: stale } = await db
      .from('email_campaigns')
      .select('id, name, status')
      .eq('sequence_key', family.sequenceKey)
      .neq('status', 'archived')

    for (const c of stale ?? []) {
      if (wantedNames.has(c.name as string)) continue
      if (APPLY) await db.from('email_campaigns').update({ status: 'archived' }).eq('id', c.id)
      console.log(`  ${APPLY ? 'archived' : 'would archive'} superseded campaign: ${c.name}`)
    }
    console.log('')
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply.\n')
    return
  }

  const { data: final } = await db
    .from('email_campaigns')
    .select('name, sequence_key, delay_days, status')
    .in('sequence_key', families.map((f) => f.sequenceKey))
    .neq('status', 'archived')
    .order('sequence_key', { ascending: true })
    .order('delay_days', { ascending: true })

  console.log('Sequences now:')
  for (const c of final ?? []) {
    console.log(`  ${String(c.sequence_key).padEnd(22)} +${String(c.delay_days).padStart(2)}d  ${String(c.name).padEnd(32)} ${c.status}`)
  }

  if (!ACTIVATE) {
    console.log('\nAll DRAFT and will not fire. In /admin/email: send yourself a Test on each,')
    console.log("then Activate each family's three together.\n")
  } else {
    console.log('\nARMED. The next member to complete onboarding starts their family sequence.\n')
  }
}

main().catch((e) => {
  console.error('\nFailed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
