import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'

/**
 * Check-in desk test events, made fresh for each spec and removed after.
 *
 * A throwaway event on the dev database (not in Sanity; the desk names it from
 * its registrations): one school group of three students plus a teacher, and
 * one student registered on their own. Nothing is emailed: rows are inserted
 * directly, not through registration.
 */

export const CHECK_IN_GROUP = 'E2E Lincoln MS'

/**
 * The volunteer mentor a `withMentor` event assigns: the event-manager
 * fixture's members row (supabase/seed.sql), which has an email and no
 * participant row on these events, so the desk lists it on the Mentors tab.
 */
export const CHECK_IN_MENTOR_MEMBER_ID = '00000000-0000-4000-a000-000000000006'

function db(): SupabaseClient {
  const url = assertE2eSupabase()
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

export function checkInConfigured(): boolean {
  // Only a missing key skips. An unrecognised database throws in db(): a skip
  // there would turn a wrong target into a green run with the desk untested.
  return (supabaseSecretKey() ?? '').length > 0
}

export async function createCheckInEvent(opts: { withMentor?: boolean } = {}): Promise<string> {
  const client = db()
  const slug = `e2e-checkin-${randomBytes(4).toString('hex')}`
  const title = `E2E Check-in ${slug.slice(-8)}`
  try {
    const { data: regs, error } = await client
      .from('registrations')
      .insert([
        { event_slug: slug, event_title: title, type: 'group', status: 'confirmed', school_name: CHECK_IN_GROUP, teacher_first_name: 'Grace', teacher_last_name: 'Hopper', student_count: 3, adult_count: 1 },
        { event_slug: slug, event_title: title, type: 'individual', status: 'confirmed' },
      ])
      .select('id, type')
    if (error) throw new Error(error.message)
    const group = regs!.find((r) => r.type === 'group')!.id
    const solo = regs!.find((r) => r.type === 'individual')!.id
    const base = { phone: '5550000000', gender: '', t_shirt_size: 'M', school_name: CHECK_IN_GROUP, event_role: 'participant', age_bracket: 'middle_school', grade: 'grade_8', date_of_birth: '2012-03-04' }
    const { error: pErr } = await client.from('participants').insert([
      { ...base, registration_id: group, first_name: 'Ana', last_name: 'Alpha', email: `ana.${slug}@example.com` },
      { ...base, registration_id: group, first_name: 'Ben', last_name: 'Bravo', email: `ben.${slug}@example.com`, health_conditions: 'Peanut allergy' },
      { ...base, registration_id: group, first_name: 'Cal', last_name: 'Charlie', email: `cal.${slug}@example.com` },
      { ...base, registration_id: group, first_name: 'Grace', last_name: 'Hopper', email: `grace.${slug}@example.com`, event_role: 'teacher', age_bracket: 'adult', grade: null, date_of_birth: '1980-01-01' },
      { ...base, registration_id: solo, first_name: 'Dee', last_name: 'Delta', email: `dee.${slug}@example.com`, school_name: 'E2E Westside High' },
    ])
    if (pErr) throw new Error(pErr.message)
    if (opts.withMentor) {
      // The event's volunteer container, as admin Volunteers assignment makes it.
      const { data: cohort, error: cErr } = await client
        .from('mentoring_cohorts')
        .insert({ name: title, container_type: 'event_participation', campaign_ref: slug, parent_container_id: null })
        .select('id')
        .single()
      if (cErr) throw new Error(cErr.message)
      const { error: mErr } = await client
        .from('cohort_members')
        .insert({ cohort_id: cohort.id, member_id: CHECK_IN_MENTOR_MEMBER_ID, relationship: 'volunteer', status: 'active' })
      if (mErr) throw new Error(mErr.message)
    }
    return slug
  } catch (err) {
    await removeCheckInEvent(slug).catch(() => {})
    throw err
  }
}

export async function removeCheckInEvent(slug: string): Promise<void> {
  if (!slug.startsWith('e2e-checkin-')) throw new Error(`refusing to remove ${slug}`)
  const client = db()
  const { data: regs } = await client.from('registrations').select('id').eq('event_slug', slug)
  const ids = (regs ?? []).map((r) => r.id as string)
  if (ids.length) await client.from('participants').delete().in('registration_id', ids)
  await client.from('registrations').delete().eq('event_slug', slug)
  await client.from('event_settings').delete().eq('event_slug', slug)
  await client.from('event_crew_check_ins').delete().eq('event_slug', slug)
  // Deleting the container removes its cohort_members rows (ON DELETE CASCADE).
  await client.from('mentoring_cohorts').delete().eq('container_type', 'event_participation').eq('campaign_ref', slug)
}
