import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { sendEmail } from '@/lib/email'
import { BRAND_NAVY, emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { SITE_URL } from '@/lib/env'
import { notifyCommunityAdmins } from '@/lib/notify'
import { mintToken, verifyToken } from '@/lib/esign/native/tokens'

// Privacy requests: a member, or a parent or guardian, asks to review the
// information Stellr holds, have it corrected or deleted, or withdraw a
// consent (Privacy Policy, "Your rights"). Anyone can ask; a request counts
// only once the requester follows the link emailed to the address they gave,
// so nobody can act on someone else's family by typing their address.
//
// What the form says back never depends on whether the address is known to
// Stellr: it cannot be used to find out who is registered.

export const REQUEST_KINDS = ['review', 'correction', 'deletion', 'withdrawal'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

export const KIND_LABEL: Record<RequestKind, string> = {
  review: 'See the information you hold',
  correction: 'Correct something that is wrong',
  deletion: 'Delete the information',
  withdrawal: 'Withdraw a consent (for example photos, or messages to my child)',
}

const LINK_TTL_SECONDS = 7 * 24 * 60 * 60
/** More than this from one address in a day: accepted on screen, but nothing more is sent. */
const DAILY_LIMIT_PER_EMAIL = 3

export const requestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  relationship: z.enum(['self', 'parent_guardian']),
  requesterName: z.string().trim().min(1).max(120),
  requesterEmail: z.string().trim().toLowerCase().email().max(254),
  subjectName: z.string().trim().max(120).optional().transform((v) => v || null),
  details: z.string().trim().max(2000).optional().transform((v) => v || null),
  /** Left empty by people; filled by form-filling bots. */
  website: z.string().max(0).optional(),
}).refine((r) => r.relationship === 'self' || !!r.subjectName, {
  message: 'Give your child’s name',
  path: ['subjectName'],
})

export type RequestInput = z.infer<typeof requestSchema>

function confirmUrl(token: string): string {
  return `${SITE_URL}/privacy/request/confirm#${token}`
}

function confirmationEmail(r: { requesterName: string; kind: RequestKind; subjectName: string | null; url: string }) {
  const about = r.subjectName ? ` about ${r.subjectName}` : ''
  const subject = 'Confirm your privacy request to Stellr Education'
  const html = emailLayout({
    heading: 'Confirm your request',
    preheader: 'One click to confirm it was you.',
    bodyHtml: `
      <p>Hi ${esc(r.requesterName)},</p>
      <p>We received a request${esc(about)}: <strong>${esc(KIND_LABEL[r.kind])}</strong>. To make sure it came from you, please confirm it. The link works for 7 days.</p>
      <p style="margin:24px 0"><a href="${esc(r.url)}" style="background:${BRAND_NAVY};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block">Confirm my request</a></p>
      <p>We answer within 30 days of confirmation. If you did not make this request, ignore this email and nothing will happen.</p>`,
  })
  const text = `Hi ${r.requesterName},\n\nWe received a request${about}: ${KIND_LABEL[r.kind]}. To make sure it came from you, please confirm it (the link works for 7 days):\n${r.url}\n\nWe answer within 30 days of confirmation. If you did not make this request, ignore this email and nothing will happen.\n\n— Stellr Education`
  return { subject, html, text }
}

/** Records a request and emails its confirmation link. Same outcome for every caller. */
export async function submitRequest(db: SupabaseClient, input: RequestInput, now = new Date()): Promise<void> {
  if (input.website) return // a bot; say nothing different
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  const { count } = await db
    .from('privacy_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requester_email', input.requesterEmail)
    .gte('created_at', since)
  if ((count ?? 0) >= DAILY_LIMIT_PER_EMAIL) return

  const { data, error } = await db.from('privacy_requests').insert({
    kind: input.kind,
    relationship: input.relationship,
    requester_name: input.requesterName,
    requester_email: input.requesterEmail,
    subject_name: input.subjectName,
    details: input.details,
    status: 'unverified',
    token_version: 1,
    created_at: now.toISOString(),
  }).select('id, token_version').single()
  if (error) throw new Error(`Recording the request failed: ${error.message}`)

  const { token } = mintToken(data.id as string, 'request', data.token_version as number, LINK_TTL_SECONDS, now.getTime())
  await sendEmail({
    to: input.requesterEmail,
    ...confirmationEmail({ requesterName: input.requesterName, kind: input.kind, subjectName: input.subjectName, url: confirmUrl(token) }),
  })
}

export type ConfirmOutcome = 'confirmed' | 'already_confirmed' | 'invalid'

/** The requester followed their link: the request now counts, and admins are told. */
export async function confirmRequest(db: SupabaseClient, token: string, meta: { ip: string | null }, now = new Date()): Promise<ConfirmOutcome> {
  const v = verifyToken(token, 'request', now.getTime())
  if (!v) return 'invalid'
  const { data: row } = await db.from('privacy_requests').select('id, kind, relationship, subject_name, status, token_version').eq('id', v.recipientId).maybeSingle()
  if (!row) return 'invalid'
  if (row.status !== 'unverified') return 'already_confirmed'
  if (row.token_version !== v.version) return 'invalid'

  const { data: updated } = await db
    .from('privacy_requests')
    .update({ status: 'verified', verified_at: now.toISOString(), verified_ip: meta.ip, token_version: v.version + 1, updated_at: now.toISOString() })
    .eq('id', row.id)
    .eq('status', 'unverified')
    .select('id')
  if (!updated?.length) return 'already_confirmed'

  const who = row.relationship === 'parent_guardian' ? `a parent or guardian${row.subject_name ? ` of ${row.subject_name}` : ''}` : 'a member'
  const body = `A confirmed privacy request from ${who}: ${KIND_LABEL[row.kind as RequestKind].toLowerCase()}. It must be answered within 30 days. See Admin → Privacy requests.`
  await notifyCommunityAdmins({
    type: 'action',
    body,
    email: { subject: 'Privacy request to answer', html: `<p>${esc(body)}</p>`, text: body },
  }).catch(() => {})
  return 'confirmed'
}

export interface MatchedRecord {
  kind: 'member' | 'participant'
  id: string
  name: string
  /** How the address matched: their own, or as the emergency contact / guardian. */
  via: 'own email' | 'guardian email'
  context: string
}

/** Records that carry the requester's address, for the admin answering the request. */
export async function findMatches(db: SupabaseClient, email: string): Promise<MatchedRecord[]> {
  // ilike for case; the address escaped so its _ and % match only themselves.
  const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`)
  const out: MatchedRecord[] = []
  const name = (r: { first_name?: string | null; last_name?: string | null }) => [r.first_name, r.last_name].filter(Boolean).join(' ') || '(no name)'
  const [{ data: own }, { data: guarded }, { data: parts }, { data: guardedParts }] = await Promise.all([
    db.from('members').select('id, first_name, last_name, event_role').ilike('email', exact).is('deleted_at', null).limit(20),
    db.from('members').select('id, first_name, last_name, event_role').ilike('ec_email', exact).is('deleted_at', null).limit(20),
    db.from('participants').select('id, first_name, last_name, registrations(event_title)').ilike('email', exact).limit(50),
    db.from('participants').select('id, first_name, last_name, registrations(event_title)').ilike('emergency_contact_email', exact).limit(50),
  ])
  const ev = (r: Record<string, unknown>) => ((Array.isArray(r.registrations) ? r.registrations[0] : r.registrations) as { event_title?: string } | null)?.event_title ?? 'an event'
  for (const r of own ?? []) out.push({ kind: 'member', id: r.id, name: name(r), via: 'own email', context: `Member (${r.event_role ?? 'no role'})` })
  for (const r of guarded ?? []) out.push({ kind: 'member', id: r.id, name: name(r), via: 'guardian email', context: `Member (${r.event_role ?? 'no role'})` })
  for (const r of parts ?? []) out.push({ kind: 'participant', id: r.id, name: name(r), via: 'own email', context: `Participant, ${ev(r)}` })
  for (const r of guardedParts ?? []) out.push({ kind: 'participant', id: r.id, name: name(r), via: 'guardian email', context: `Participant, ${ev(r)}` })
  return out
}

export const resolveSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'refused']),
  note: z.string().trim().max(2000).optional(),
}).refine((r) => r.status === 'in_progress' || !!r.note, { message: 'Say what was done, or why not', path: ['note'] })

export async function resolveRequest(db: SupabaseClient, id: string, input: z.infer<typeof resolveSchema>, by: string, now = new Date()): Promise<boolean> {
  const { data } = await db
    .from('privacy_requests')
    .update({
      status: input.status,
      resolution_note: input.note ?? null,
      handled_by: by,
      handled_at: input.status === 'in_progress' ? null : now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', id)
    .in('status', ['verified', 'in_progress'])
    .select('id')
  return !!data?.length
}

/** Unconfirmed requests go after 30 days; answered ones are kept 3 years as the record of the answer. */
export async function purgeRequests(db: SupabaseClient, now = new Date()): Promise<{ unverified: number; handled: number }> {
  const day = 86_400_000
  const { data: a } = await db.from('privacy_requests').delete().eq('status', 'unverified').lte('created_at', new Date(now.getTime() - 30 * day).toISOString()).select('id')
  const { data: b } = await db.from('privacy_requests').delete().in('status', ['completed', 'refused']).lte('handled_at', new Date(now.getTime() - 3 * 365 * day).toISOString()).select('id')
  return { unverified: a?.length ?? 0, handled: b?.length ?? 0 }
}
