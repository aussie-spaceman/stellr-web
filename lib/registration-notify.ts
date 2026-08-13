// Registration-time email: the member's account confirmation, and the staff
// alert that someone joined.
//
// Both are TRANSACTIONAL and deliberately do NOT go through the campaign engine
// (lib/email-campaigns.ts). That engine always suppresses on marketing_consent,
// which is correct for marketing but wrong here: a member who opts out of
// marketing must still be told their account exists. Marketing follow-up is a
// separate concern — see the 'member.created' drip campaigns.
//
// Every export is best-effort: onboarding must never fail because an email did.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, DEFAULT_REPLY_TO } from '@/lib/email'
import { emailLayout, escapeHtml } from '@/lib/email-layout'
import { appUrl } from '@/lib/email-campaigns'

/** Where new-registration alerts land. Env-overridable so it can move without a deploy. */
function staffAlertEmail(): string {
  return process.env.REGISTRATION_ALERT_EMAIL ?? process.env.CONTACT_EMAIL ?? 'hello@stellreducation.org'
}

export interface RegisteredMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  event_role: string | null
  age_bracket: string | null
}

/** Human label for a members.event_role value. */
const ROLE_LABEL: Record<string, string> = {
  teacher: 'Educator',
  mentor: 'Mentor',
  parent: 'Parent / Guardian',
  volunteer: 'Volunteer',
  participant: 'Student',
  school_student_manager: 'Student Manager',
  subscriber: 'Subscriber',
  adult: 'Adult',
}

function displayName(m: RegisteredMember): string {
  return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || (m.email ?? 'New member')
}

/**
 * The member's current tier name and the spaces that tier opens, for the
 * confirmation email. Returns nulls rather than throwing — a member with no
 * membership row still gets a valid (if less specific) welcome.
 */
async function tierContext(
  db: SupabaseClient,
  memberId: string,
): Promise<{ tierName: string | null; spaceNames: string[] }> {
  const { data: membership } = await db
    .from('member_memberships')
    .select('tier_id, membership_tiers(name)')
    .eq('member_id', memberId)
    .eq('renewal_status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership?.tier_id) return { tierName: null, spaceNames: [] }

  const tier = Array.isArray(membership.membership_tiers)
    ? membership.membership_tiers[0]
    : membership.membership_tiers
  const tierName = (tier as { name?: string } | null)?.name ?? null

  const { data: spaceRows } = await db
    .from('community_space_tiers')
    .select('community_spaces(name, is_archived)')
    .eq('tier_id', membership.tier_id)

  const spaceNames = (spaceRows ?? [])
    .map((r) => {
      const s = Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces
      return s as { name?: string; is_archived?: boolean } | null
    })
    .filter((s): s is { name: string; is_archived: boolean } => !!s?.name && !s.is_archived)
    .map((s) => s.name)

  return { tierName, spaceNames }
}

/**
 * Confirm the account to the member who just completed onboarding. Sent to
 * everyone regardless of marketing consent — see the module header.
 */
export async function sendAccountConfirmation(db: SupabaseClient, member: RegisteredMember): Promise<void> {
  if (!member.email) return

  try {
    const { tierName, spaceNames } = await tierContext(db, member.id)
    const first = member.first_name?.trim() || 'there'
    const home = `${appUrl()}/home`
    const spaces = `${appUrl()}/spaces`

    // Only claim tier/space access when we actually resolved it — a vague
    // "explore your resources" beats naming a tier the member doesn't hold.
    const tierLine = tierName
      ? `<p>Your membership is <strong>${escapeHtml(tierName)}</strong>${
          spaceNames.length
            ? `, which opens ${spaceNames.map((n) => `<strong>${escapeHtml(n)}</strong>`).join(' and ')}`
            : ''
        }. Everything included is already unlocked — nothing else to activate.</p>`
      : '<p>Your membership is active and your resources are unlocked.</p>'

    const bodyHtml = `
      <p>Hi ${escapeHtml(first)},</p>
      <p>Your Stellr Education account is live. Welcome to the community.</p>
      ${tierLine}
      <p style="margin:24px 0">
        <a href="${spaces}" style="background:#1e3a5f;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">Open your Spaces</a>
      </p>
      <p>You can see your membership and update your details any time at
        <a href="${home}">${escapeHtml(home)}</a>.</p>
      <p>Questions, or something not working as you'd expect? Reply to this email — it reaches a person.</p>
    `

    const text = [
      `Hi ${first},`,
      '',
      'Your Stellr Education account is live. Welcome to the community.',
      '',
      tierName
        ? `Your membership is ${tierName}${spaceNames.length ? `, which opens ${spaceNames.join(' and ')}` : ''}. Everything included is already unlocked.`
        : 'Your membership is active and your resources are unlocked.',
      '',
      `Open your Spaces: ${spaces}`,
      `Your account: ${home}`,
      '',
      "Questions, or something not working as you'd expect? Reply to this email — it reaches a person.",
    ].join('\n')

    await sendEmail({
      to: member.email,
      replyTo: DEFAULT_REPLY_TO,
      subject: 'Welcome to Stellr Education — your account is live',
      html: emailLayout({
        heading: 'Welcome to Stellr Education',
        preheader: 'Your account is live and your membership resources are unlocked.',
        bodyHtml,
      }),
      text,
    })
  } catch (e) {
    console.error('[registration-notify] account confirmation failed (non-fatal):', e)
  }
}

/**
 * Tell staff that someone registered. Mirrors the lead-form alerts
 * (app/api/contact et al) so registrations stop being the one funnel signal
 * nobody is told about.
 */
export async function notifyStaffOfRegistration(
  db: SupabaseClient,
  member: RegisteredMember,
  extra: { schoolName?: string | null } = {},
): Promise<void> {
  try {
    const { tierName } = await tierContext(db, member.id)
    const name = displayName(member)
    const role = ROLE_LABEL[member.event_role ?? ''] ?? member.event_role ?? '—'
    const person360 = `${appUrl()}/admin/members/${member.id}`

    const rows: Array<[string, string]> = [
      ['Name', name],
      ['Email', member.email ?? '—'],
      ['Role', role],
      ['Age bracket', member.age_bracket ?? '—'],
      ['School', extra.schoolName ?? '—'],
      ['Tier granted', tierName ?? '—'],
    ]

    const bodyHtml = `
      <p><strong>${escapeHtml(name)}</strong> completed registration.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:8px;font-weight:bold;background:#f3f4f6;width:35%">${escapeHtml(k)}</td><td style="padding:8px">${escapeHtml(v)}</td></tr>`,
          )
          .join('')}
      </table>
      <p><a href="${person360}">Open in the admin console</a></p>
    `

    const text = [
      `${name} completed registration.`,
      '',
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      `Admin: ${person360}`,
    ].join('\n')

    await sendEmail({
      to: staffAlertEmail(),
      replyTo: member.email ?? undefined,
      subject: `New registration: ${name} (${role})`,
      html: emailLayout({ heading: 'New registration', bodyHtml }),
      text,
    })
  } catch (e) {
    console.error('[registration-notify] staff alert failed (non-fatal):', e)
  }
}
