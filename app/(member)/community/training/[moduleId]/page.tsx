import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getModule } from '@/lib/training'
import { TrainingItemRow } from '@/components/community/TrainingItemRow'

export const metadata = { title: 'Community · Training Module' }

export default async function TrainingModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { moduleId } = await params
  const mod = await getModule(member, moduleId)
  if (!mod) notFound()

  // Tier gate (entitlement-aware). Free-tier members see an upgrade prompt
  // rather than the lesson list (FR-COM-08 / FR-COM-10).
  if (!mod.canAccess) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-bold text-gray-900">{mod.title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          This training is available to a higher membership tier.
        </p>
        <a
          href="/account?tab=billing"
          className="mt-4 inline-block rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
        >
          Upgrade to access
        </a>
      </div>
    )
  }

  const pct = mod.itemCount > 0 ? Math.round((mod.completedCount / mod.itemCount) * 100) : 0

  return (
    <div>
      <Link
        href="/community/training"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Training
      </Link>

      <h1 className="text-2xl font-bold text-gray-900">{mod.title}</h1>
      {mod.description && <p className="mt-1 text-sm text-gray-500">{mod.description}</p>}

      <div className="mt-4 mb-6">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
          <span>
            {mod.completedCount} of {mod.itemCount} complete
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div className="h-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <ul className="space-y-3">
        {mod.items.map((item) => (
          <TrainingItemRow key={item.id} item={item} />
        ))}
      </ul>

      {mod.items.length === 0 && (
        <p className="text-sm text-gray-500">No lessons in this module yet.</p>
      )}
    </div>
  )
}
