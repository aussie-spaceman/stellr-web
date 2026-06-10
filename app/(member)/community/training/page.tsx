import { redirect } from 'next/navigation'
import Link from 'next/link'
import { GraduationCap, Lock, AlertCircle } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { listModules, getAssignedModules, type TrainingModuleSummary } from '@/lib/training'
import { getMemberEvents } from '@/lib/event-portal'

export const metadata = { title: 'Community · Training' }

function ProgressBadge({ m }: { m: TrainingModuleSummary }) {
  const done = m.itemCount > 0 && m.completedCount === m.itemCount
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {m.completedCount} of {m.itemCount} complete
    </span>
  )
}

function ModuleCard({ m }: { m: TrainingModuleSummary }) {
  const body = (
    <div
      className={`rounded-lg border bg-white p-4 ${
        m.canAccess ? 'border-gray-200 hover:border-gray-300' : 'border-gray-200 opacity-75'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">{m.title}</h3>
              {!m.canAccess && <Lock className="h-3.5 w-3.5 text-amber-500" />}
              {m.isMandatory && (
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-600">
                  Mandatory
                </span>
              )}
            </div>
            {m.description && <p className="mt-0.5 text-sm text-gray-500">{m.description}</p>}
            {m.dueAt && (
              <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                <AlertCircle className="h-3.5 w-3.5" />
                Due {new Date(m.dueAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>
        <ProgressBadge m={m} />
      </div>
    </div>
  )

  return m.canAccess ? (
    <Link href={`/community/training/${m.id}`} className="block">
      {body}
    </Link>
  ) : (
    <div className="block">{body}</div>
  )
}

// FR-COM-10 — Training section.
// Shows (1) modules assigned for the member's upcoming events (mandatory surfaced
// first), and (2) the wider catalogue split by Event/Campaign vs CTE vs general.
export default async function TrainingPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const events = await getMemberEvents(member)
  const eventRefs = events.map((e) => e.eventId).filter((id): id is string => !!id)
  // event_role isn't carried on CommunityMember; assignments also accept 'all'.
  const assigned = await getAssignedModules(member, { eventRefs, eventRoles: [] })
  assigned.sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory))

  const all = await listModules(member)
  const cte = all.filter((m) => m.material_kind === 'cte')
  const general = all.filter((m) => m.material_kind === 'general')

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Training</h1>
        <p className="mt-1 text-sm text-gray-500">
          Complete training for your events, plus ongoing courses available with your membership.
        </p>
      </div>

      {assigned.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            For your events
          </h2>
          <div className="space-y-3">
            {assigned.map((m) => (
              <ModuleCard key={`${m.id}-${m.event_ref}`} m={m} />
            ))}
          </div>
        </section>
      )}

      {cte.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Career &amp; Technical Education (CTE)
          </h2>
          <div className="space-y-3">
            {cte.map((m) => (
              <ModuleCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}

      {general.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Library
          </h2>
          <div className="space-y-3">
            {general.map((m) => (
              <ModuleCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}

      {assigned.length === 0 && all.length === 0 && (
        <p className="text-sm text-gray-500">No training available yet. Check back soon.</p>
      )}
    </div>
  )
}
