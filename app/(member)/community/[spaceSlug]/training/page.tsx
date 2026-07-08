import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getSpaceForMember } from '@/lib/spaces'
import { supabaseServer } from '@/lib/supabase'
import { resolveTierMap } from '@/lib/tiers-server'
import { describeAssignedTiers } from '@/lib/tiers'
import { resolveRequirement, type BracketRequirements } from '@/lib/space-training'
import { formatDateShort } from '@/lib/utils'
import { SpaceShell } from '@/components/community/spaces/SpaceShell'
import { LockedSpaceGate } from '@/components/community/spaces/LockedSpaceGate'

export const dynamic = 'force-dynamic'

interface CourseCard {
  id: string
  title: string
  description: string | null
  mandatory: boolean
  dueAt: string | null
  total: number
  done: number
}

export default async function SpaceTrainingPage({
  params,
}: {
  params: Promise<{ spaceSlug: string }>
}) {
  const { spaceSlug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const space = await getSpaceForMember(member, spaceSlug)
  if (!space) notFound()
  if (!space.access.canAccess) return <LockedSpaceGate space={space} />

  // Tier note (handoff): which membership tier grants this space's training. Space
  // training is space-scoped, so the note is the space's access requirement — open
  // spaces are included for everyone; private/secret name their assigned tiers.
  const tierMap = await resolveTierMap()
  const tierNote =
    space.access_type === 'open' || space.assignedTierIds.length === 0
      ? 'Included with your membership'
      : `Included with ${describeAssignedTiers(space.assignedTierIds, tierMap.nameById)}`

  const db = supabaseServer()
  const { data: links } = await db
    .from('community_space_training')
    .select('training_module_id, is_mandatory, bracket_requirements, display_order')
    .eq('space_id', space.id)
    .order('display_order', { ascending: true })

  const moduleIds = (links ?? []).map((l) => (l as { training_module_id: string }).training_module_id)
  // Mandatory + deadline are resolved against THIS member's age bracket, falling
  // back to the legacy is_mandatory flag when their bracket has no override.
  const reqById = new Map<string, { mandatory: boolean; dueAt: string | null }>()
  for (const l of (links ?? []) as { training_module_id: string; is_mandatory: boolean; bracket_requirements: BracketRequirements | null }[]) {
    reqById.set(l.training_module_id, resolveRequirement(l.bracket_requirements, member.age_bracket, l.is_mandatory))
  }

  let cards: CourseCard[] = []
  if (moduleIds.length > 0) {
    const [{ data: modules }, { data: items }] = await Promise.all([
      db.from('training_modules').select('id, title, description').in('id', moduleIds),
      db.from('training_items').select('id, module_id').in('module_id', moduleIds),
    ])
    const itemsByModule = new Map<string, string[]>()
    for (const it of (items ?? []) as { id: string; module_id: string }[]) {
      const arr = itemsByModule.get(it.module_id) ?? []
      arr.push(it.id)
      itemsByModule.set(it.module_id, arr)
    }
    const allItemIds = (items ?? []).map((i) => (i as { id: string }).id)
    const completed = new Set<string>()
    if (allItemIds.length > 0) {
      const { data: progress } = await db
        .from('training_progress')
        .select('item_id')
        .eq('member_id', member.id)
        .eq('status', 'completed')
        .in('item_id', allItemIds)
      for (const p of (progress ?? []) as { item_id: string }[]) completed.add(p.item_id)
    }

    cards = (modules ?? []).map((m) => {
      const mod = m as { id: string; title: string; description: string | null }
      const ids = itemsByModule.get(mod.id) ?? []
      const req = reqById.get(mod.id)
      return {
        id: mod.id,
        title: mod.title,
        description: mod.description,
        mandatory: req?.mandatory ?? false,
        dueAt: req?.dueAt ?? null,
        total: ids.length,
        done: ids.filter((id) => completed.has(id)).length,
      }
    })
    // Preserve the configured display order.
    cards.sort((a, b) => moduleIds.indexOf(a.id) - moduleIds.indexOf(b.id))
  }

  return (
    <SpaceShell space={space} activeKey="training">
      <div className="mx-auto max-w-[760px]">
        <h1 className="mb-4 font-heading text-[21px] text-brand-blue-dark">Training</h1>
        {cards.length === 0 ? (
          <p className="py-10 text-center text-sm text-brand-muted-soft">No training assigned to this space.</p>
        ) : (
          <div className="space-y-3">
            {cards.map((c) => {
              const pct = c.total ? Math.round((c.done / c.total) * 100) : 0
              const status = c.done === 0 ? 'Not started' : c.done < c.total ? 'In progress' : 'Complete'
              const cta = c.done === 0 ? 'Start' : c.done < c.total ? 'Continue' : 'Review'
              const statusColor =
                status === 'Complete' ? '#1FA97A' : status === 'In progress' ? '#2C53C6' : '#6B7290'
              return (
                <article key={c.id} className="rounded-[14px] border border-brand-border bg-white p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-heading text-[16px] text-brand-blue-dark">{c.title}</h2>
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-subheading font-semibold uppercase tracking-[0.05em]"
                          style={
                            c.mandatory
                              ? { background: '#FBEAEA', color: '#C0392B' }
                              : { background: '#EEF0F6', color: '#5C637E' }
                          }
                        >
                          {c.mandatory ? 'Mandatory' : 'Optional'}
                        </span>
                        {c.mandatory && c.dueAt && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[10px] font-subheading font-semibold uppercase tracking-[0.05em]"
                            style={{ background: '#FFF4E0', color: '#B4740A' }}
                          >
                            Due {formatDateShort(c.dueAt)}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[11px] font-subheading font-semibold uppercase tracking-[0.04em] text-brand-muted-soft">{tierNote}</p>
                      {c.description && <p className="mt-1 text-sm text-brand-muted">{c.description}</p>}
                    </div>
                    <span className="shrink-0 text-xs font-subheading font-semibold" style={{ color: statusColor }}>
                      {status}
                    </span>
                  </div>

                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-brand-canvas">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: statusColor }} />
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-brand-muted-soft">
                      {c.done}/{c.total} lessons
                    </span>
                    <Link
                      href={`/community/training/${c.id}`}
                      className="rounded-lg bg-brand-blue px-3 py-1.5 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark"
                    >
                      {cta}
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </SpaceShell>
  )
}
