/**
 * Post-event survey e2e fixtures that need the app's own modules, run under
 * tsx. Prints one JSON value on stdout. Used by ./survey.ts only.
 *
 *   tsx e2e/fixtures/survey-cli.ts create [--open]   → { slug, distributionId }
 *   tsx e2e/fixtures/survey-cli.ts link <slug> <first name> → "/survey/<token>"
 *   tsx e2e/fixtures/survey-cli.ts remove <slug>
 *
 * Each test gets its own throwaway event (not in Sanity) on the dev database:
 *   Sam — college student, own email           → student path, no consent gate
 *   Ada — the seed member (16), V2.3 agreement → student path via dashboard
 * Opening it sends no email: the Resend key is dropped for this process.
 */
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'
const ADA = '00000000-0000-4000-a000-000000000001'

async function main() {
  delete process.env.RESEND_API_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`survey e2e fixtures only run against the dev project (${DEV_PROJECT_REF})`)
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
  const [command, ...args] = process.argv.slice(2)

  if (command === 'create') {
    const slug = `e2e-survey-${randomBytes(4).toString('hex')}`
    const title = `E2E Survey ${slug.slice(-8)}`
    // The current minors template (optional link; the survey reads agreement_version).
    const { data: tpl } = await db.from('esign_templates').select('id').eq('key', 'minor').eq('active', true).maybeSingle()
    const { data: reg, error: regErr } = await db
      .from('registrations')
      .insert({ event_slug: slug, event_title: title, type: 'group', status: 'confirmed', school_address_state: 'CO', adult_count: 0 })
      .select('id')
      .single()
    if (regErr) throw new Error(regErr.message)
    const base = { registration_id: reg.id, phone: '5550000000', gender: '', t_shirt_size: 'M', school_name: 'E2E High', event_role: 'participant' }
    const { data: parts, error: pErr } = await db
      .from('participants')
      .insert([
        { ...base, first_name: 'Sam', last_name: 'Tester', email: `sam.${slug}@example.com`, date_of_birth: '2004-02-02', age_bracket: 'college', grade: 'college_junior' },
        { ...base, first_name: 'Ada', last_name: 'Student', email: 'ada.student+clerk_test@example.com', date_of_birth: '2010-01-01', age_bracket: 'high_school', grade: 'grade_11', member_id: ADA, emergency_contact_email: `guardian.${slug}@example.com` },
      ])
      .select('id, first_name')
    if (pErr) throw new Error(pErr.message)
    const ada = parts!.find((p) => p.first_name === 'Ada')!.id
    const { data: ag, error: agErr } = await db
      .from('agreements')
      .insert({ participant_id: ada, member_id: ADA, event_slug: slug, event_title: title, envelope_id: `e2e-${slug}`, envelope_type: 'minor', status: 'completed', provider: 'native', signer_name: 'Guardian', signer_email: `guardian.${slug}@example.com`, minor_name: 'Ada Student', completed_at: new Date().toISOString(), template_id: tpl?.id ?? null, agreement_version: '2.3' })
      .select('id')
      .single()
    if (agErr) throw new Error(agErr.message)
    await db.from('agreement_recipients').insert({ envelope_row: ag.id, recipient_id: '1', role_name: 'Guardian', name: 'Guardian', email: `guardian.${slug}@example.com`, status: 'completed', signer_values: { DigitalCommsOptOut: 'false', QuoteOptOut: 'false' } })

    const { ensureDistribution, setEarlierGoLive } = await import('../../lib/survey/distributions')
    const { localDate } = await import('../../lib/survey/timezone')
    const lastDay = localDate(new Date(Date.now() + 5 * 86_400_000), 'America/Denver')
    const r = await ensureDistribution(db, { slug, title, date: lastDay, endDate: null, lastDay, timeZone: 'America/Denver', state: 'CO', cancelled: false, isCampaign: false })
    if (r.action === 'skipped') throw new Error(`distribution skipped: ${r.reason}`)
    if (args.includes('--open')) {
      const opened = await setEarlierGoLive(db, r.distribution, 'now', { memberId: null, label: 'e2e' })
      if (!opened.ok) throw new Error(opened.error)
      const { runOne } = await import('../../lib/survey/run')
      await runOne(db, r.distribution.id)
    }
    return { slug, distributionId: r.distribution.id }
  }

  if (command === 'link') {
    const [slug, firstName] = args
    const { data: d } = await db.from('survey_distributions').select('id').eq('event_slug', slug).single()
    const { data: inv, error } = await db.from('survey_invitations').select('id, token_version').eq('distribution_id', d!.id).eq('first_name', firstName).single()
    if (error) throw new Error(error.message)
    const { surveyToken } = await import('../../lib/survey/tokens')
    return `/survey/${surveyToken(inv.id as string, inv.token_version as number)}`
  }

  if (command === 'remove') {
    const [slug] = args
    if (!slug?.startsWith('e2e-survey-')) throw new Error('refusing to remove a non-e2e event')
    const { data: regs } = await db.from('registrations').select('id').eq('event_slug', slug)
    const regIds = (regs ?? []).map((r) => r.id as string)
    const { data: parts } = regIds.length ? await db.from('participants').select('id').in('registration_id', regIds) : { data: [] }
    const pids = (parts ?? []).map((p) => p.id as string)
    const { data: d } = await db.from('survey_distributions').select('id').eq('event_slug', slug).maybeSingle()
    if (d) {
      const { data: invs } = await db.from('survey_invitations').select('participant_id, member_id, email').eq('distribution_id', d.id)
      await db.rpc('survey_purge_person', { p_member_id: null, p_participant_ids: [...pids, ...(invs ?? []).map((i) => i.participant_id).filter(Boolean)], p_emails: (invs ?? []).filter((i) => !i.member_id).map((i) => i.email), p_actor: 'e2e' })
      // Ada's invitation is keyed by member; remove this event's rows only.
      await db.from('survey_invitations').delete().eq('distribution_id', d.id)
      await db.from('survey_distributions').delete().eq('id', d.id)
    }
    if (pids.length) {
      const { data: ags } = await db.from('agreements').select('id').in('participant_id', pids)
      const agIds = (ags ?? []).map((a) => a.id as string)
      if (agIds.length) {
        await db.from('agreement_recipients').delete().in('envelope_row', agIds)
        await db.from('agreements').delete().in('id', agIds)
      }
      await db.from('participants').delete().in('id', pids)
    }
    if (regIds.length) await db.from('registrations').delete().in('id', regIds)
    return true
  }
  throw new Error(`unknown command ${command}`)
}

main()
  .then((v) => console.log(JSON.stringify(v)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
