import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowLeft, FileText, Lock } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { memberIsParticipant, getEventMaterials } from '@/lib/event-portal'
import { listModules } from '@/lib/training'
import { MaterialDownloadButton } from '@/components/community/MaterialDownloadButton'

export const metadata = { title: 'Community · Event' }

// FR-COM-13 — per-event portal page. Only accessible to participants of the
// event; surfaces the event's gated materials and any training tied to it.
export default async function EventPortalPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { slug } = await params
  const event = await memberIsParticipant(member, slug)
  if (!event) notFound() // not a participant → no access

  const materials = await getEventMaterials(member, event)
  const training = event.eventId
    ? await listModules(member, { eventRef: event.eventId })
    : []

  const isCampaign = event.activityType === 'campaign'

  return (
    <div>
      <Link
        href="/events"
        className="mb-4 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Events
      </Link>

      {/* Orange event hero — mirrors the Home next-event treatment (T3.5) */}
      <div
        className="relative overflow-hidden rounded-card-lg p-6 text-white"
        style={{ background: 'linear-gradient(115deg,#E0922F,#C2722A)' }}
      >
        <Image
          src="/images/logo-icon.svg"
          alt=""
          width={180}
          height={180}
          className="pointer-events-none absolute -bottom-10 -right-8 opacity-[0.12] brightness-0 invert"
        />
        <div className="relative">
          <span className="eyebrow rounded-full bg-white/20 px-2.5 py-1 text-[11px]">
            {isCampaign ? 'Campaign' : 'Live Event'}
          </span>
          <h1 className="mt-2 font-heading text-[27px] uppercase">{event.title}</h1>
          {event.date && (
            <p className="mt-1 text-[13.5px] text-orange-100">
              {new Date(event.date + 'T00:00:00').toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          )}
        </div>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">
          Materials
        </h2>
        {materials.length === 0 ? (
          <p className="text-sm text-brand-muted-soft">No materials posted yet.</p>
        ) : (
          <ul className="space-y-3">
            {materials.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-brand-border bg-white p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-muted-soft" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-brand-blue-dark">{m.title}</h3>
                      {!m.canDownload && <Lock className="h-3.5 w-3.5 text-brand-gold-ink" />}
                    </div>
                    {m.description && <p className="mt-0.5 text-sm text-brand-muted-soft">{m.description}</p>}
                  </div>
                </div>
                <div className="shrink-0">
                  {m.canDownload ? (
                    <MaterialDownloadButton
                      endpoint={`/api/community/events/${slug}/materials/${m.id}/download`}
                      title={m.title}
                    />
                  ) : (
                    <a
                      href="/account?tab=billing"
                      className="inline-block rounded-md border border-brand-orange bg-brand-orange/5 px-3 py-1.5 text-xs font-medium text-brand-gold-ink hover:bg-brand-orange/10"
                    >
                      Upgrade
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {training.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">
            Training
          </h2>
          <ul className="space-y-3">
            {training.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/community/training/${t.id}`}
                  className="flex items-center justify-between rounded-lg border border-brand-border bg-white p-4 hover:border-brand-border"
                >
                  <span className="font-medium text-brand-blue-dark">{t.title}</span>
                  <span className="text-xs text-brand-muted-soft">
                    {t.completedCount} of {t.itemCount} complete
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
