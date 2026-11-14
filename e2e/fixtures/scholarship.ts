import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'

/**
 * Scholarship e2e fixtures (tracker scholarship-offers.9). Each test applies
 * under its own address at example.test, so every row it makes is found, and
 * removed, by that address alone: the application, the student's member record
 * an offer creates, and that member's activity entries. Nothing here touches a
 * seeded row or another test's rows.
 */

/** An event every environment with the CMS has (pd-credentials uses it too). */
export const SCHOLARSHIP_EVENT = 'nevada-space-design-challenge'

export interface Applicant {
  firstName: string
  lastName: string
  email: string
}

export function newApplicant(): Applicant {
  const tag = randomBytes(4).toString('hex')
  return { firstName: 'Riley', lastName: `Scholar${tag}`, email: `e2e-scholarship-${tag}@example.test` }
}

function db(): SupabaseClient {
  const url = assertE2eSupabase()
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

export interface ApplicationRow {
  id: string
  status: string
  first_name: string
  last_name: string
  email: string
  activity: string
  brief: string
  event_slug: string | null
  event_title: string | null
  member_id: string | null
  percent_off: number | null
  offer_token: string | null
  registration_id: string | null
}

/** The one application filed under `email`, or null. Fails on more than one. */
export async function applicationFor(email: string): Promise<ApplicationRow | null> {
  const { data, error } = await db()
    .from('scholarship_applications')
    .select('id, status, first_name, last_name, email, activity, brief, event_slug, event_title, member_id, percent_off, offer_token, registration_id')
    .eq('email', email)
  if (error) throw new Error(`reading the application: ${error.message}`)
  if ((data ?? []).length > 1) throw new Error(`expected one application for ${email}, found ${data!.length}`)
  return ((data ?? [])[0] as ApplicationRow | undefined) ?? null
}

/** The member record an offer matched or created for `email`, if any. */
export async function memberFor(email: string): Promise<{ id: string; email: string; first_name: string } | null> {
  const { data, error } = await db().from('members').select('id, email, first_name').ilike('email', email).maybeSingle()
  if (error) throw new Error(`reading the member: ${error.message}`)
  return data as { id: string; email: string; first_name: string } | null
}

/**
 * Everything a test filed under `email`. Only example.test addresses minted by
 * newApplicant() are accepted, so a typo can never reach a real person's rows.
 */
export async function removeApplicant(email: string): Promise<void> {
  if (!/^e2e-scholarship-[0-9a-f]{8}@example\.test$/.test(email)) throw new Error(`refusing to remove ${email}`)
  const client = db()
  const { error: appError } = await client.from('scholarship_applications').delete().eq('email', email)
  if (appError) throw new Error(`removing the application: ${appError.message}`)
  const member = await memberFor(email)
  if (member) {
    const { error: logError } = await client.from('member_activity_log').delete().eq('member_id', member.id)
    if (logError) throw new Error(`removing the member's activity: ${logError.message}`)
    const { error: memberError } = await client.from('members').delete().eq('id', member.id)
    if (memberError) throw new Error(`removing the member: ${memberError.message}`)
  }
}

/**
 * Stand-in for "Offer & register" where the server cannot read the CMS (the CI
 * e2e job has no Sanity project, so the offer route answers 400 for every
 * event). Writes the same decision columns lib/scholarship-offer.ts writes, on
 * this test's own row, so the offer link can still be exercised. The real route
 * is used wherever the CMS is readable.
 */
export async function recordOfferDirectly(applicationId: string, percent: number, eventSlug: string, eventTitle: string): Promise<string> {
  const token = randomBytes(32).toString('hex') // lib/scholarships.ts mintOfferToken
  const now = new Date().toISOString()
  const { error } = await db()
    .from('scholarship_applications')
    .update({ status: 'offered', percent_off: percent, event_slug: eventSlug, event_title: eventTitle, offer_token: token, reviewed_at: now, offered_at: now })
    .eq('id', applicationId)
    .eq('status', 'submitted')
  if (error) throw new Error(`recording the offer: ${error.message}`)
  return token
}

/**
 * Whether the server under test reads events from the CMS: an event page
 * renders only when it can (lib/sanity.ts has no client without a project id).
 */
export async function serverReadsCms(request: APIRequestContext): Promise<boolean> {
  const res = await request.get(`/events/${SCHOLARSHIP_EVENT}`, { maxRedirects: 0 })
  return res.status() === 200
}
