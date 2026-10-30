// The Friday digest email: the dashboard's week, as counts, plus the oldest
// few outstanding items. Pure: digest in, { subject, html, text } out.
//
// Privacy (decided 29 Oct 2026): counts for every metric; names only on
// outstanding items, and never a minor's. A minor's consent form is listed
// under the guardian who has to sign it. Queues whose people may be minors
// (coaching requests, scholarship applicants) go as counts. Everything else is
// one click away on the dashboard, behind the admin sign-in.

import { emailLayout, escapeHtml, BRAND_NAVY } from '@/lib/email-layout'
import { formatUsd } from '@/lib/mentoring-format'
import { roleLabel, outstandingCount, type MemberDigest, type Metric } from '@/lib/admin-digest'

const TOP = 5
const TZ = 'America/Denver'
const MUTED = '#5b6474'

const GAP_REASONS: Record<string, string> = {
  not_issued: 'never sent',
  issue_failed: 'failed to send',
  voided: 'voided or expired',
  declined: 'declined',
  bounced: 'email bounced',
}

const REVIEW_STATES: Record<string, string> = {
  awaiting_verification: 'licence to verify',
  flagged: 'background check to decide',
}

function day(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso))
}

function daysWaiting(iso: string, now: Date): string {
  const d = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000))
  return d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`
}

function delta(m: Metric): string {
  const diff = m.current - m.previous
  if (diff === 0) return 'same as last week'
  return `${diff > 0 ? '+' : '−'}${Math.abs(diff)} on last week`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "3 participants, 2 mentors" from a role tally. */
function byRoleWords(byRole: Record<string, number>): string {
  return Object.entries(byRole)
    .sort(([, a], [, b]) => b - a)
    .map(([role, n]) => `${n} ${roleLabel(role).toLowerCase()}${n === 1 ? '' : 's'}`)
    .join(', ')
}

interface Line { text: string; sub?: string }
interface Block { title: string; count: number; lines: Line[]; note?: string; href: string }

export function renderDigestEmail(
  digest: MemberDigest,
  opts: { appUrl: string; now?: Date },
): { subject: string; html: string; text: string } {
  const now = opts.now ?? new Date(digest.window.end)
  const { growth, left, engagement, mentoring, outstanding: o } = digest
  const url = (path: string) => `${opts.appUrl}${path}`
  const waiting = outstandingCount(o)
  const leftTotal = left.deactivated.current + left.lapsed.current + left.unsubscribed.current + left.withdrew.current

  const subject =
    `Stellr weekly digest: ${plural(growth.newMembers.current, 'new member')}, ` +
    `${plural(waiting, 'item')} waiting on you`
  const period = `${day(digest.window.start)} to ${day(digest.window.end)}`

  // ── The week, as counts ────────────────────────────────────────────────────
  const groups: Array<{ title: string; rows: Array<[string, Metric, string?]> }> = [
    {
      title: 'New',
      rows: [
        ['New members', growth.newMembers, byRoleWords(growth.newMembers.byRole) || undefined],
        ['Event registrations', growth.registrations, growth.registrations.participants ? plural(growth.registrations.participants, 'participant') : undefined],
      ],
    },
    {
      title: 'Left',
      rows: [
        ['Accounts closed', left.deactivated],
        ['Memberships lapsed', left.lapsed],
        ['Unsubscribed from email', left.unsubscribed],
        ['Withdrew from an event', left.withdrew],
      ],
    },
    {
      title: 'Community spaces',
      rows: [
        ['Members active in spaces', engagement.activeMembers],
        ['Posts', engagement.posts],
        ['Comments', engagement.comments],
        ['Reactions', engagement.reactions],
        ['Space chat messages', engagement.chatMessages],
        ['New space members', engagement.spaceJoins],
      ],
    },
    {
      title: 'Mentoring and coaching',
      rows: [
        ['Coaching requests', mentoring.coachingRequests],
        ['Joined a mentoring group', mentoring.cohortJoins],
        ['Volunteered for an event', mentoring.volunteerSignups],
        ['New mentors', mentoring.newMentors],
      ],
    },
  ]

  // ── Outstanding, oldest first ──────────────────────────────────────────────
  const sameName = (a: string, b: string | null) => !!b && a.trim().toLowerCase() === b.trim().toLowerCase()
  const blocks: Block[] = [
    {
      title: 'Consent forms awaiting signature',
      count: o.awaitingSignature.length,
      href: '/admin/docusigns',
      lines: o.awaitingSignature.slice(0, TOP).map((a) => ({
        text: a.minorName
          ? sameName(a.signerName, a.minorName) ? 'A student’s consent form' : `${a.signerName} (parent or guardian)`
          : a.signerName,
        sub: [a.eventTitle, `waiting ${daysWaiting(a.sentAt, now)}`, a.reminders ? plural(a.reminders, 'reminder') : null].filter(Boolean).join(' · '),
      })),
    },
    {
      title: 'Consent forms needing action',
      count: o.paperworkGaps.length,
      href: '/admin/docusigns',
      lines: o.paperworkGaps.slice(0, TOP).map((g) => ({
        text: g.minor ? 'A student' : g.name || 'A participant',
        sub: `${g.eventTitle} · ${GAP_REASONS[g.reason] ?? g.reason}`,
      })),
    },
    {
      title: 'Verifications needing your decision',
      count: o.verifications.review.length,
      href: '/admin/compliance',
      lines: o.verifications.review.slice(0, TOP).map((r) => ({
        text: r.name,
        sub: `${roleLabel(r.eventRole)} · ${REVIEW_STATES[r.state] ?? r.state}`,
      })),
      note: [
        o.verifications.inProcess ? `${o.verifications.inProcess} background ${o.verifications.inProcess === 1 ? 'check' : 'checks'} in progress` : null,
        o.verifications.missing ? `${plural(o.verifications.missing, 'adult')} with no valid clearance on file` : null,
      ].filter(Boolean).join('; ') || undefined,
    },
    {
      title: 'Unpaid',
      count: o.payments.length,
      href: '/admin',
      lines: o.payments.slice(0, TOP).map((p) => ({
        text: `${p.minor ? 'A student' : p.who}${p.amountCents ? ` · ${formatUsd(p.amountCents)}` : ''}`,
        sub: `${p.eventTitle} · ${p.detail} · since ${day(p.since)}`,
      })),
      note: o.paymentsTotalCents ? `${formatUsd(o.paymentsTotalCents)} outstanding in total` : undefined,
    },
    {
      title: 'Other requests',
      count: o.queues.coaching.length + o.queues.scholarships.length + o.queues.privacy.length + o.queues.deletions.length,
      href: '/admin',
      lines: [
        ...(o.queues.coaching.length ? [{ text: `${plural(o.queues.coaching.length, 'coaching request')} waiting for a coach`, sub: `oldest ${day(o.queues.coaching[0].at)}` }] : []),
        ...(o.queues.scholarships.length ? [{ text: `${plural(o.queues.scholarships.length, 'scholarship application')} to review`, sub: `oldest ${day(o.queues.scholarships[0].at)}` }] : []),
        ...o.queues.privacy.slice(0, TOP).map((q) => ({ text: q.label, sub: `${q.detail ?? ''} · since ${day(q.at)}` })),
        ...o.queues.deletions.slice(0, TOP).map((q) => ({ text: q.label, sub: `since ${day(q.at)}` })),
      ],
    },
  ]

  // ── HTML ───────────────────────────────────────────────────────────────────
  const cell = 'padding:6px 0;border-bottom:1px solid #e6e9f0;font-size:15px;vertical-align:top'
  const groupsHtml = groups.map((g) => `
    <p style="margin:24px 0 4px;font-size:13px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_NAVY}">${escapeHtml(g.title)}</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      ${g.rows.map(([label, m, sub]) => `
      <tr>
        <td style="${cell}">${escapeHtml(label)}${sub ? `<br/><span style="font-size:13px;color:${MUTED}">${escapeHtml(sub)}</span>` : ''}</td>
        <td style="${cell};text-align:right;white-space:nowrap"><strong>${m.current}</strong><br/><span style="font-size:13px;color:${MUTED}">${escapeHtml(delta(m))}</span></td>
      </tr>`).join('')}
    </table>`).join('')

  const visible = blocks.filter((b) => b.count > 0)
  const blocksHtml = visible.length === 0
    ? '<p>Nothing is waiting on you. Every consent form, verification, payment and request is up to date.</p>'
    : visible.map((b) => `
    <p style="margin:20px 0 4px"><strong>${escapeHtml(b.title)} (${b.count})</strong></p>
    <ul style="margin:0;padding-left:20px">
      ${b.lines.map((l) => `<li style="margin:4px 0">${escapeHtml(l.text)}${l.sub ? `<br/><span style="font-size:13px;color:${MUTED}">${escapeHtml(l.sub)}</span>` : ''}</li>`).join('')}
    </ul>
    ${b.count > b.lines.length && b.lines.length > 0 ? `<p style="margin:4px 0;font-size:13px;color:${MUTED}">and ${b.count - b.lines.length} more</p>` : ''}
    ${b.note ? `<p style="margin:4px 0;font-size:13px;color:${MUTED}">${escapeHtml(b.note)}</p>` : ''}
    <p style="margin:4px 0;font-size:13px"><a href="${url(b.href)}" style="color:${BRAND_NAVY}">Open in admin</a></p>`).join('')

  const errorsHtml = digest.errors.length
    ? `<p style="margin:16px 0;padding:12px;background:#fdf1f0;border-radius:8px;font-size:14px">Some sections didn’t load and may read low: ${escapeHtml(digest.errors.join(', '))}. Check the dashboard.</p>`
    : ''

  const bodyHtml = `
    <p style="margin:0 0 8px">Member activity from ${escapeHtml(period)} (Mountain time), compared with the week before.</p>
    ${leftTotal || growth.newMembers.current ? '' : '<p style="margin:0 0 8px">A quiet week: no one joined or left.</p>'}
    ${errorsHtml}
    ${groupsHtml}
    <p style="margin:32px 0 4px;font-size:13px;font-weight:bold;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_NAVY}">Waiting on you (${waiting})</p>
    ${blocksHtml}
    <p style="margin:32px 0 0"><a href="${url('/admin')}" style="display:inline-block;padding:12px 20px;background:${BRAND_NAVY};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Open the dashboard</a></p>
    <p style="margin:24px 0 0;font-size:13px;color:${MUTED}">Sent every Friday at midday Mountain time to staff with the “all” scope. Change who gets it on <a href="${url('/admin/staff')}" style="color:${MUTED}">Staff roles</a>.</p>`

  const html = emailLayout({
    heading: 'Your weekly member digest',
    preheader: `${plural(growth.newMembers.current, 'new member')}, ${leftTotal} left or lapsed, ${plural(waiting, 'item')} waiting on you.`,
    bodyHtml,
  })

  // ── Plain text ─────────────────────────────────────────────────────────────
  const text = [
    'Your weekly member digest',
    `Member activity from ${period} (Mountain time), compared with the week before.`,
    ...(digest.errors.length ? ['', `Some sections didn't load and may read low: ${digest.errors.join(', ')}.`] : []),
    ...groups.flatMap((g) => [
      '',
      g.title.toUpperCase(),
      ...g.rows.map(([label, m, sub]) => `- ${label}: ${m.current} (${delta(m)})${sub ? ` - ${sub}` : ''}`),
    ]),
    '',
    `WAITING ON YOU (${waiting})`,
    ...(visible.length === 0
      ? ['Nothing is waiting on you.']
      : visible.flatMap((b) => [
          '',
          `${b.title} (${b.count})`,
          ...b.lines.map((l) => `- ${l.text}${l.sub ? ` - ${l.sub}` : ''}`),
          ...(b.count > b.lines.length && b.lines.length > 0 ? [`  and ${b.count - b.lines.length} more`] : []),
          ...(b.note ? [`  ${b.note}`] : []),
          `  ${url(b.href)}`,
        ])),
    '',
    `Open the dashboard: ${url('/admin')}`,
    '',
    'Sent every Friday at midday Mountain time to staff with the "all" scope.',
  ].join('\n')

  return { subject, html, text }
}
