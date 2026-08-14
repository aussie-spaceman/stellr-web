// Registration-time email: the member's account confirmation, and the staff
// alert that someone joined.
//
// The confirmation is email 1 of the four-email welcome every member gets. Its
// body varies by tier FAMILY (teacher / high school / college) — see FAMILY_COPY
// below. Emails 2-4 are the marketing drip, seeded by
// scripts/seed-welcome-drips.ts, which keys off the same TIER_GROUPS.
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
import { emailLayout, escapeHtml, BRAND_NAVY, SIGN_OFF_HTML, SIGN_OFF_TEXT } from '@/lib/email-layout'
import { appUrl } from '@/lib/email-campaigns'
import { tierGroupOf, type TierGroupKey } from '@/lib/tiers'

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

export interface RenderedConfirmation {
  subject: string
  html: string
  text: string
}

// ─── Per-family confirmation copy ────────────────────────────────────────────
//
// Email 1 of the four-email welcome is one template for everybody, varied by
// tier FAMILY (lib/tiers.ts TIER_GROUPS) rather than by individual tier. Only the
// two middle paragraphs change: what the member finds in their Space, and what
// the Community means for them. Everything else — the tier-active line, the
// portal link, the "tell us what's missing" invitation, the sign-off — is shared,
// so a change to the house welcome lands once.
//
// Sentences are plain text with no HTML metacharacters, so the same string
// serves both the HTML and the text part. Keep it that way.

interface FamilyCopy {
  /** Continues "…you'll see the dedicated <Space>, " — so it starts lowercase. */
  spaceContents: string
  /** A whole paragraph about the Community, in that family's register. */
  community: string
}

const NEUTRAL_COPY: FamilyCopy = {
  spaceContents: 'with the resources, reference material and training your membership opens up.',
  community:
    "You'll also see some Community components - chat, directory etc - and we encourage you to introduce yourself and join the conversation.",
}

const FAMILY_COPY: Record<TierGroupKey, FamilyCopy> = {
  teacher: {
    spaceContents:
      'with classroom ready content: lesson plans, student worksheets, and the narrative material we use at our in-person events.',
    community: NEUTRAL_COPY.community,
  },
  high_school: {
    spaceContents:
      'with everything you need to enter a Stellr Competition and do well in it: the Competition briefs, self-paced training courses, and reference material.',
    community:
      "You'll also see the Community - chat, the member directory, and mentors who do this work for a living. Introduce yourself. Asking questions is the point, and nobody there thinks a beginner question is a bad one.",
  },
  college: {
    spaceContents:
      'with Competition material, hands-on career preparation, and the STEM Power Skills training that employers keep asking about.',
    community:
      "You'll also see the Community - chat, the member directory, and the Stellr Network of universities, providers and employers we work with. Introduce yourself and tell us what you're working toward.",
  },
}

/** Which body copy a tier gets. Unknown or family-less tiers get neutral copy. */
export function confirmationCopyFor(tierName: string | null): FamilyCopy {
  const group = tierName ? tierGroupOf(tierName) : null
  return group ? FAMILY_COPY[group] : NEUTRAL_COPY
}

/**
 * Build the account-confirmation email without sending it. Split out from the
 * send so a preview is provably the same bytes that ship — a hand-copied preview
 * drifts from the real template the moment either is edited.
 */
export function renderAccountConfirmation(
  member: Pick<RegisteredMember, 'first_name'>,
  ctx: { tierName: string | null; spaceNames: string[] },
): RenderedConfirmation {
  const { tierName, spaceNames } = ctx
  const first = member.first_name?.trim() || 'there'
  const signIn = `${appUrl()}/sign-in`

  // "your Educator membership" when the tier resolved; a neutral "membership"
  // when it didn't, so the sentence never reads "Your is now active".
  const tierPhrase = tierName ? `${escapeHtml(tierName)} membership` : 'membership'
  // Prefer the Space's real name ("Educator Tier Space") over a constructed one.
  const spacePhrase = spaceNames.length
    ? spaceNames.map((n) => escapeHtml(n)).join(' and ')
    : tierName
      ? `${escapeHtml(tierName)} Space`
      : 'membership Space'
  const spacePhraseText = spaceNames.length
    ? spaceNames.join(' and ')
    : `${tierName ?? 'membership'} Space`

  const copy = confirmationCopyFor(tierName)

  const bodyHtml = `
      <p style="margin:0 0 16px">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 16px">Your <strong>${tierPhrase}</strong> is now active, and you can now access your Stellr resources from our membership portal. We recommend bookmarking this log-in link: <a href="${signIn}" style="color:${BRAND_NAVY}">${escapeHtml(signIn)}</a></p>
      <p style="margin:0 0 16px">Once in our portal, you'll see the dedicated <strong>${spacePhrase}</strong>, ${copy.spaceContents}</p>
      <p style="margin:0 0 16px">${copy.community}</p>
      <p style="margin:0 0 16px">If something you expected to see isn't there, reply and tell us. We'd rather hear it early.</p>
      <p style="margin:0 0 24px">Welcome to the Stellr Community!</p>
      ${SIGN_OFF_HTML}
    `

  const text = [
    `Hi ${first},`,
    '',
    `Your ${tierName ? `${tierName} membership` : 'membership'} is now active, and you can now access your Stellr resources from our membership portal. We recommend bookmarking this log-in link: ${signIn}`,
    '',
    `Once in our portal, you'll see the dedicated ${spacePhraseText}, ${copy.spaceContents}`,
    '',
    copy.community,
    '',
    "If something you expected to see isn't there, reply and tell us. We'd rather hear it early.",
    '',
    'Welcome to the Stellr Community!',
    '',
    SIGN_OFF_TEXT,
  ].join('\n')

  return {
    subject: 'Welcome to the Stellr Community',
    html: emailLayout({
      heading: 'Welcome to the Stellr Community',
      preheader: 'Your membership is active — here is how to get into the portal.',
      bodyHtml,
    }),
    text,
  }
}

/**
 * Confirm the account to the member who just completed onboarding. Sent to
 * everyone regardless of marketing consent — see the module header.
 */
export async function sendAccountConfirmation(db: SupabaseClient, member: RegisteredMember): Promise<void> {
  if (!member.email) return

  try {
    const { tierName, spaceNames } = await tierContext(db, member.id)
    const { subject, html, text } = renderAccountConfirmation(member, { tierName, spaceNames })

    await sendEmail({ to: member.email, replyTo: DEFAULT_REPLY_TO, subject, html, text })
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
