import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { MEDIA_REASON_LABEL, MEDIA_STATUS_LABEL, mediaDoNotUseList, type MediaStatus } from '@/lib/survey/media'

// /admin/media — the media do-not-use list (privacy runbook Part C). Check it
// before using any event photo, video, name or student work in promotion.
// One rule decides every row (lib/survey/media.ts): withdrawn consent, the
// opt-out on the signed agreement, the student's own switch, a minor with no
// form, and the NY/CO 13–17 default. Admins only.
export const metadata = { title: 'Admin — Media do-not-use' }
export const dynamic = 'force-dynamic'

const PILL: Record<MediaStatus, string> = {
  no: 'bg-danger/10 text-danger',
  check: 'bg-pathway-amber-bg text-brand-gold-ink',
  yes: 'bg-enviro-green-bg text-enviro-green-text',
}

export default async function MediaDoNotUsePage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')
  const eventSlug = (await searchParams).event || null

  const db = supabaseServer()
  const [{ rows, considered }, { data: regs }] = await Promise.all([
    mediaDoNotUseList(db, { eventSlug }),
    db.from('registrations').select('event_slug, event_title, created_at').order('created_at', { ascending: false }).limit(2000),
  ])
  const events = new Map<string, string>()
  for (const r of regs ?? []) if (r.event_slug && !events.has(r.event_slug as string)) events.set(r.event_slug as string, (r.event_title as string | null) ?? (r.event_slug as string))

  const no = rows.filter((r) => r.decision.status === 'no').length
  const check = rows.length - no
  const csvHref = `/api/admin/media/do-not-use${eventSlug ? `?event=${encodeURIComponent(eventSlug)}` : ''}`

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Media do-not-use</h1>
        <p className="mt-0.5 max-w-prose text-sm text-brand-muted-soft">
          Check this before using anyone’s photo, video, name or work in promotion. It applies opt-outs on signed agreements, students’ own photo/media switches, withdrawn consents and the NY/CO default for 13–17-year-olds. Opt-outs sent by email aren’t in the data: keep adding those to the list by hand.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 text-sm" method="get">
        <label className="text-brand-muted">
          <span className="block text-xs">Event</span>
          <select name="event" defaultValue={eventSlug ?? ''} className="mt-1 rounded-lg border border-brand-border bg-white px-2 py-1.5">
            <option value="">All events</option>
            {[...events].map(([slug, title]) => (
              <option key={slug} value={slug}>
                {title}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-lg bg-brand-blue px-3 py-1.5 font-medium text-white">Apply</button>
        <a className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-brand-muted" href={csvHref}>
          Download CSV
        </a>
      </form>

      <p className="text-sm text-brand-muted" role="status">
        {`${no} do not use · ${check} to check by hand · ${considered} people considered${eventSlug ? ' for this event' : ''}.`}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-brand-border bg-white p-5 text-sm text-brand-muted-soft">Nobody is on the list{eventSlug ? ' for this event' : ''}.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-brand-border bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-brand-muted-soft">
              <tr>
                <th className="px-3 py-2">Media</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Age</th>
                <th className="px-3 py-2">School</th>
                <th className="px-3 py-2">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-hairline">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL[r.decision.status]}`}>{MEDIA_STATUS_LABEL[r.decision.status]}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">{`${r.firstName} ${r.lastName}`.trim() || '—'}</td>
                  <td className="px-3 py-2 text-brand-muted">{r.eventTitle ?? r.eventSlug ?? '—'}</td>
                  <td className="px-3 py-2 text-brand-muted">{r.age ?? '—'}</td>
                  <td className="px-3 py-2 text-brand-muted">{[r.school, r.states.join(', ')].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-3 py-2 text-brand-muted">{MEDIA_REASON_LABEL[r.decision.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
