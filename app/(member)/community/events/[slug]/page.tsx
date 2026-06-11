import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
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
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Events
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-gray-900">{event.title}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isCampaign ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
          }`}
        >
          {isCampaign ? 'Campaign' : 'Live Event'}
        </span>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Materials
        </h2>
        {materials.length === 0 ? (
          <p className="text-sm text-gray-500">No materials posted yet.</p>
        ) : (
          <ul className="space-y-3">
            {materials.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{m.title}</h3>
                      {!m.canDownload && <Lock className="h-3.5 w-3.5 text-amber-500" />}
                    </div>
                    {m.description && <p className="mt-0.5 text-sm text-gray-500">{m.description}</p>}
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
                      className="inline-block rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
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
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Training
          </h2>
          <ul className="space-y-3">
            {training.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/community/training/${t.id}`}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
                >
                  <span className="font-medium text-gray-900">{t.title}</span>
                  <span className="text-xs text-gray-500">
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
