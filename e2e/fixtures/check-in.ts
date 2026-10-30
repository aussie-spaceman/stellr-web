import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

/**
 * Check-in desk test events, made fresh for each spec and removed after.
 *
 * A throwaway event on the dev database (not in Sanity; the desk names it from
 * its registrations): one school group of three students plus a teacher, and
 * one student registered on their own. Nothing is emailed: rows are inserted
 * directly, not through registration.
 */

const DEV_PROJECT_REF = 'xvxlhbxtiwxpopoqjygm'
export const CHECK_IN_GROUP = 'E2E Lincoln MS'

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (!url.includes(DEV_PROJECT_REF)) throw new Error(`check-in e2e fixtures only run against the dev project (${DEV_PROJECT_REF})`)
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY as string, { auth: { persistSession: false } })
}

export function checkInConfigured(): boolean {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').length > 0 && (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').includes(DEV_PROJECT_REF)
}

export async function createCheckInEvent(): Promise<string> {
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
}
