/**
 * survey-seed-dev.ts — a fake event with fake people on DEV, to walk every
 * survey path (handover §10 rollout step 1).
 *
 *   npm run survey:seed-dev              create the demo event + scheduled survey
 *   npm run survey:seed-dev -- --open    …and send it live now, printing each link
 *   npm run survey:seed-dev -- --reset   delete everything the demo created
 *
 * Uses the minors template labelled V2.3 on dev (it must exist). Creates no template.
 *
 * Event "survey-demo-2026" (Nebraska, so the age of majority is 19):
 *   Alex  16  V2.3 agreement, own email           → invited (student)
 *   Bea   15  V2.3 agreement, §4 comms opt-out     → invited via guardian
 *   Cal   14  no agreement                         → awaiting V2.3 consent
 *   Dana  20  college                              → invited (student, adult)
 *   Pat   parent on the roster                     → invited (adult, parent)
 *   Terry the registering teacher                  → invited (adult, teacher)
 *   Morgan volunteer mentor                        → invited (mentor)
 *
 * Emails are NOT sent: RESEND_API_KEY is dropped for this process, so the
 * mailer only logs. Pass --send to send them (dev reroutes to the safelist).
 * Refuses any project but dev.
 */
import { existsSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'
const SLUG = 'survey-demo-2026'
const TITLE = 'Survey Demo SDC 2026'
const DOMAIN = 'survey-demo.example.com'

async function main() {
  const args = process.argv.slice(2)
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(DEV_PROJECT_REF)) {
    throw new Error('Refusing: .env.local does not point at the dev Supabase project.')
  }
  if (!args.includes('--send')) delete process.env.RESEND_API_KEY

  const { supabaseServer } = await import('../lib/supabase')
  const db = supabaseServer()

  if (args.includes('--reset')) return reset(db)

  // The current minors template (optional link; the survey reads agreement_version).
  const { data: tpl } = await db.from('esign_templates').select('id').eq('key', 'minor').eq('active', true).maybeSingle()

  const { data: existingReg } = await db.from('registrations').select('id').eq('event_slug', SLUG).maybeSingle()
  let regId = existingReg?.id as string | undefined
  if (!regId) {
    const { data, error } = await db
      .from('registrations')
      .insert({
        event_slug: SLUG,
        event_title: TITLE,
        type: 'group',
        status: 'confirmed',
        teacher_first_name: 'Terry',
        teacher_last_name: 'Teacher',
        teacher_email: `terry.teacher@${DOMAIN}`,
        school_name: 'Demo High School',
        school_address_state: 'NE',
        registrant_role: 'teacher',
        adult_count: 3,
        student_count: 4,
      })
      .select('id')
      .single()
    if (error) throw new Error(`registration: ${error.message}`)
    regId = data.id as string

    const p = (first: string, dob: string, role = 'participant', grade: string | null = null, email: string | null = null) => ({
      registration_id: regId,
      first_name: first,
      last_name: 'Demo',
      email: email ?? `${first.toLowerCase()}@${DOMAIN}`,
      phone: '5550000000',
      date_of_birth: dob,
      gender: '',
      t_shirt_size: 'M',
      school_name: role === 'participant' ? 'Demo High School' : '',
      age_bracket: role === 'participant' && grade?.startsWith('college') ? 'college' : role === 'participant' ? 'high_school' : 'adult',
      event_role: role,
      grade,
      emergency_contact_first_name: 'Guardian',
      emergency_contact_last_name: 'Demo',
      emergency_contact_email: `guardian.${first.toLowerCase()}@${DOMAIN}`,
    })
    const { data: parts, error: pErr } = await db
      .from('participants')
      .insert([
        p('Alex', '2010-03-01', 'participant', '11'),
        p('Bea', '2011-04-01', 'participant', '10'),
        p('Cal', '2012-05-01', 'participant', '9'),
        p('Dana', '2006-01-15', 'participant', 'college_sophomore'),
        p('Pat', '1980-06-01', 'parent'),
      ])
      .select('id, first_name')
    if (pErr) throw new Error(`participants: ${pErr.message}`)
    const id = (n: string) => parts!.find((x) => x.first_name === n)!.id as string

    // V2.3 agreements for Alex (no opt-outs) and Bea (§4 digital-comms opt-out).
    for (const [name, values] of [
      ['Alex', { DigitalCommsOptOut: 'false', MediaOptOut: 'false', QuoteOptOut: 'false' }],
      ['Bea', { DigitalCommsOptOut: 'true', MediaOptOut: 'false', QuoteOptOut: 'false' }],
    ] as const) {
      const { data: ag, error: agErr } = await db
        .from('agreements')
        .insert({
          participant_id: id(name),
          event_slug: SLUG,
          event_title: TITLE,
          envelope_id: `dev-survey-${name.toLowerCase()}-${Date.now()}`,
          envelope_type: 'minor',
          status: 'completed',
          provider: 'native',
          signer_name: `Guardian Demo`,
          signer_email: `guardian.${name.toLowerCase()}@${DOMAIN}`,
          minor_name: `${name} Demo`,
          completed_at: new Date().toISOString(),
          template_id: tpl?.id ?? null,
          agreement_version: '2.3',
          digital_comms_opt_out: String(values.DigitalCommsOptOut) === 'true',
          quote_opt_out: String(values.QuoteOptOut) === 'true',
          media_opt_out: String(values.MediaOptOut) === 'true',
        })
        .select('id')
        .single()
      if (agErr) throw new Error(`agreement: ${agErr.message}`)
      const { error: rErr } = await db.from('agreement_recipients').insert({
        envelope_row: ag.id,
        recipient_id: '1',
        role_name: 'Guardian',
        name: 'Guardian Demo',
        email: `guardian.${name.toLowerCase()}@${DOMAIN}`,
        status: 'completed',
        signer_values: values,
      })
      if (rErr) throw new Error(`recipient: ${rErr.message}`)
    }
  }

  // Volunteer mentor.
  const mentorEmail = `morgan.mentor@${DOMAIN}`
  let { data: mentor } = await db.from('members').select('id').eq('email', mentorEmail).maybeSingle()
  if (!mentor) {
    const { data, error } = await db
      .from('members')
      .insert({ first_name: 'Morgan', last_name: 'Mentor', email: mentorEmail, age_bracket: 'adult', event_role: 'mentor', date_of_birth: '1985-01-01' })
      .select('id')
      .single()
    if (error) throw new Error(`mentor: ${error.message}`)
    mentor = data
  }
  const { data: ep } = await db.from('event_participations').select('id').eq('member_id', mentor!.id).eq('event_slug', SLUG).maybeSingle()
  if (!ep) {
    const { error } = await db.from('event_participations').insert({ member_id: mentor!.id, event_slug: SLUG, event_title: TITLE, event_year: 2026, role: 'volunteer', status: 'approved' })
    if (error) throw new Error(`event_participations: ${error.message}`)
  }

  // Scheduled survey: the event's last day is a week out, Central time (Nebraska).
  const { ensureDistribution, setEarlierGoLive } = await import('../lib/survey/distributions')
  const { localDate } = await import('../lib/survey/timezone')
  const lastDay = localDate(new Date(Date.now() + 7 * 86_400_000), 'America/Chicago')
  const ensured = await ensureDistribution(db, {
    slug: SLUG,
    title: TITLE,
    date: lastDay,
    endDate: null,
    lastDay,
    timeZone: 'America/Chicago',
    state: 'NE',
    cancelled: false,
    isCampaign: false,
  })
  if (ensured.action === 'skipped') throw new Error(`distribution skipped: ${ensured.reason}`)
  let dist = ensured.distribution
  console.log(`Distribution ${dist.id}: ${dist.status}, opens ${dist.opens_at}, closes ${dist.closes_at}`)

  const { planFor } = await import('../lib/survey/distributions')
  const plan = await planFor(db, dist)
  console.log(`Plan: ${plan.invitable.length} invitable, ${plan.awaitingConsent.length} awaiting V2.3, ${plan.unreachable.length} unreachable, ${plan.headcountOnlyAdults} headcount-only adults`)

  if (args.includes('--open') && dist.status === 'scheduled') {
    const r = await setEarlierGoLive(db, dist, 'now', { memberId: null, label: 'script:survey-seed-dev' })
    if (!r.ok) throw new Error(r.error)
    dist = r.distribution
  }
  if (dist.status === 'open') {
    const { runOne } = await import('../lib/survey/run')
    const res = await runOne(db, dist.id)
    console.log(`Ran: ${res.newInvitations} new invitations, ${res.tally.invited} sent, ${res.tally.deferred} deferred`)
    const { data: invs } = await db.from('survey_invitations').select('id, token_version, first_name, respondent_role, adult_relationship, send_via, email, status').eq('distribution_id', dist.id)
    const { surveyToken } = await import('../lib/survey/tokens')
    const base = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'http://localhost:3000'
    for (const i of invs ?? []) {
      const token = surveyToken(i.id as string, i.token_version as number)
      console.log(`  ${String(i.first_name).padEnd(7)} ${String(i.respondent_role).padEnd(7)} ${String(i.adult_relationship ?? '').padEnd(8)} via ${i.send_via} → ${base}/survey/${token}`)
    }
  }
}

async function reset(db: import('@supabase/supabase-js').SupabaseClient) {
  const { data: dists } = await db.from('survey_distributions').select('id').eq('event_slug', SLUG)
  for (const d of dists ?? []) {
    await db.rpc('survey_purge_person', { p_member_id: null, p_participant_ids: [], p_emails: [], p_actor: 'script:survey-seed-dev' })
    const { data: invs } = await db.from('survey_invitations').select('id, participant_id, member_id, email').eq('distribution_id', d.id)
    const participantIds = (invs ?? []).map((i) => i.participant_id).filter(Boolean)
    const emails = (invs ?? []).map((i) => i.email)
    await db.rpc('survey_purge_person', { p_member_id: null, p_participant_ids: participantIds, p_emails: emails, p_actor: 'script:survey-seed-dev' })
    await db.from('survey_distributions').delete().eq('id', d.id)
  }
  const { data: regs } = await db.from('registrations').select('id').eq('event_slug', SLUG)
  for (const r of regs ?? []) {
    const { data: parts } = await db.from('participants').select('id').eq('registration_id', r.id)
    const ids = (parts ?? []).map((p) => p.id as string)
    if (ids.length) {
      const { data: ags } = await db.from('agreements').select('id').in('participant_id', ids)
      const agIds = (ags ?? []).map((a) => a.id as string)
      if (agIds.length) {
        await db.from('agreement_recipients').delete().in('envelope_row', agIds)
        await db.from('agreements').delete().in('id', agIds)
      }
      await db.from('participants').delete().in('id', ids)
    }
    await db.from('registrations').delete().eq('id', r.id)
  }
  const { data: mentor } = await db.from('members').select('id').eq('email', `morgan.mentor@${DOMAIN}`).maybeSingle()
  if (mentor) {
    await db.from('event_participations').delete().eq('member_id', mentor.id)
    await db.from('members').delete().eq('id', mentor.id)
  }
  console.log('Demo event removed.')
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
