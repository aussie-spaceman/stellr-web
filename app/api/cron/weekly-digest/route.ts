import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'
import { sendEmail, staffAlertEmail } from '@/lib/email'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'
import { loadMemberDigest, outstandingCount } from '@/lib/admin-digest'
import { renderDigestEmail } from '@/lib/admin-digest-email'
import { appUrl } from '@/lib/email-campaigns'
import { isDigestSendTime } from '@/lib/weekly-digest-schedule'

// GET /api/cron/weekly-digest — the admin dashboard's week, emailed every
// Friday at midday Mountain time (see lib/weekly-digest-schedule for why
// vercel.json schedules it twice).
//
// Recipients are staff holding the 'all' scope on /admin/staff, so no address
// lives in this public repo and adding a co-admin there adds them here. With
// nobody holding it, the digest goes to the staff inbox rather than nowhere —
// the lesson of 28 Sept 2026, when every admin alert reached nobody.
//
// Unlike lead-capture-failures this sends every week, quiet or not: it is a
// digest people read, not an alarm.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB = 'weekly-digest'

/** Emails of active members holding the 'all' staff scope. Throws so the caller can fall back. */
async function digestRecipients(db: SupabaseClient): Promise<string[]> {
  const { data: roles, error } = await db.from('staff_roles').select('member_id').overlaps('scopes', ['all'])
  if (error) throw new Error(error.message)
  const ids = [...new Set((roles ?? []).map((r) => r.member_id as string).filter(Boolean))]
  if (ids.length === 0) return []
  const { data: members, error: memberError } = await db.from('members').select('email').in('id', ids).eq('is_active', true)
  if (memberError) throw new Error(memberError.message)
  return [...new Set((members ?? []).map((m) => (m.email as string | null)?.trim().toLowerCase()).filter((e): e is string => !!e))]
}

/** Whether a run already sent the digest in the last 20 hours. */
async function alreadySent(db: SupabaseClient, now: Date): Promise<boolean> {
  const { data, error } = await db
    .from('cron_runs')
    .select('id')
    .eq('job', JOB)
    .eq('result->>sent', 'true')
    .gte('started_at', new Date(now.getTime() - 20 * 3_600_000).toISOString())
    .limit(1)
  if (error) console.error('[cron:weekly-digest] duplicate check failed:', error.message)
  return (data ?? []).length > 0
}

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const now = new Date()
  // The other of the two scheduled runs: not midday in Denver. Not recorded,
  // so the ledger shows one row per Friday.
  if (!isDigestSendTime(now)) {
    return NextResponse.json({ skipped: true, reason: 'not Friday midday in Denver' })
  }

  const db = supabaseServer()
  if (await alreadySent(db, now)) {
    return NextResponse.json({ skipped: true, reason: 'already sent today' })
  }

  const run = await startCronRun(db, JOB)

  let recipients: string[] = []
  try {
    recipients = await digestRecipients(db)
  } catch (err) {
    console.error('[cron:weekly-digest] recipient lookup failed; falling back to the staff inbox:', err)
    run.fail('recipients', err)
  }
  const fallback = recipients.length === 0
  if (fallback) recipients = [staffAlertEmail()]

  let digest
  try {
    digest = await loadMemberDigest(7, { now, db })
  } catch (err) {
    console.error('[cron:weekly-digest] digest failed:', err)
    run.fail('digest', err)
    await run.finish({ sent: false })
    return NextResponse.json({ sent: false, error: 'digest failed' }, { status: 500 })
  }
  for (const section of digest.errors) run.fail('section', section)

  const email = renderDigestEmail(digest, { appUrl: appUrl(), now })
  let delivered = 0
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: email.subject, html: email.html, text: email.text })
      delivered++
    } catch (err) {
      console.error('[cron:weekly-digest] send failed:', err)
      run.fail('send', err)
    }
  }

  // Counts only: the ledger is not the place for addresses.
  const result = {
    sent: delivered > 0,
    recipients: recipients.length,
    delivered,
    fallback,
    newMembers: digest.growth.newMembers.current,
    outstanding: outstandingCount(digest.outstanding),
  }
  await run.finish(result)
  return NextResponse.json(result, { status: delivered > 0 ? 200 : 500 })
}
