import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Global, Document, Team } from '@stellr/icons'
import { Button } from '@stellr/web-ui'
import { getCurrentMember } from '@/lib/community'
import { supabaseServer } from '@/lib/supabase'
import { ResourceDownloadButton } from '@/components/community/ResourceDownloadButton'

export const dynamic = 'force-dynamic'

interface ResourceRow {
  id: string
  title: string
  description: string | null
  file_size_bytes: number | null
}

// The single free "global competition" Space every educator / student manager
// joins. Free material + group chat, NO deadline and NO registered students —
// with a prompt to move into a specific Campaign. This static route shadows the
// generic /community/[spaceSlug] view for the Commons landing; the group-chat
// channel still lives at /community/educator-commons/c/general.
export default async function EducatorCommonsPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const db = supabaseServer()
  const { data: space } = await db
    .from('community_spaces')
    .select('id, name, description')
    .eq('slug', 'educator-commons')
    .maybeSingle()

  // Seeded resources are all free (open space, no per-resource gate deployed).
  const resources: ResourceRow[] = space
    ? ((
        await db
          .from('community_resources')
          .select('id, title, description, file_size_bytes')
          .eq('space_id', space.id)
          .order('created_at', { ascending: true })
      ).data as ResourceRow[] | null) ?? []
    : []

  // The judging rubric is a higher-tier upsell — shown locked to free members so
  // everyone SEES more material exists (rendered statically; not a real download).
  const showRubricUpsell = !member.hasPaidTier

  return (
    <div className="space-y-6">
      <Link href="/home" className="text-sm text-content-muted hover:text-content">
        ← Dashboard
      </Link>

      {/* Header */}
      <section className="rounded-panel bg-midnight px-8 py-10 text-white">
        <p className="flex items-center gap-1.5 text-ds-eyebrow uppercase tracking-widest text-hero-dim">
          <Global className="h-3.5 w-3.5" /> Global · all educators
        </p>
        <h1 className="mt-2 font-heading text-4xl font-bold">{space?.name ?? 'Educator Commons'}</h1>
        <p className="mt-3 max-w-2xl text-hero-lead">
          {space?.description ??
            'A single space for every educator and student manager. Grab free campaign material, ask questions in the group chat. No deadlines here — register a group in a Campaign when you’re ready to submit.'}
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Free resources */}
        <section className="rounded-panel border border-line bg-white p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-ds-h3 font-bold text-ink">Free resources</h2>
            <span className="text-xs text-content-muted">Assigned to your space</span>
          </div>
          <ul className="mt-4 divide-y divide-line-light">
            {resources.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface text-content-secondary">
                  <Document className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-content">{r.title}</p>
                  <p className="text-xs text-content-muted">
                    Free
                    {r.file_size_bytes ? ` · ${(r.file_size_bytes / 1_048_576).toFixed(1)} MB` : ''}
                  </p>
                </div>
                <ResourceDownloadButton resourceId={r.id} title={r.title} />
              </li>
            ))}

            {/* Higher-tier upsell — free members SEE that more material exists. */}
            {showRubricUpsell && (
              <li className="flex items-center gap-3 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-surface text-content-secondary">
                  <Lock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-content">
                    Judging rubric &amp; exemplar proposals
                  </p>
                  <p className="text-xs text-content-muted">Catalyst tier</p>
                </div>
                <Link href="/membership" className="text-sm font-semibold text-pathway-amber hover:underline">
                  Upgrade
                </Link>
              </li>
            )}

            {resources.length === 0 && !showRubricUpsell && (
              <li className="py-6 text-sm text-content-muted">Resources are being added — check back soon.</li>
            )}
          </ul>
        </section>

        {/* Group chat */}
        <section className="rounded-panel border border-line bg-white p-6">
          <h2 className="font-heading text-ds-h3 font-bold text-ink">Group chat</h2>
          <p className="mt-1 text-sm text-content-secondary">
            Ask questions and compare notes with other educators running Campaigns.
          </p>
          <div className="mt-5 flex items-center gap-3 rounded-ds-card bg-surface px-4 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-control bg-enviro-green-chip text-enviro-green-text">
              <Team className="h-5 w-5" />
            </span>
            <p className="text-sm text-content-secondary">Every educator is in this chat — jump in any time.</p>
          </div>
          <div className="mt-4">
            <Button href="/community/educator-commons/c/general" variant="primary" className="w-full justify-center">
              Open group chat
            </Button>
          </div>
        </section>
      </div>

      {/* Move-to-campaign prompt */}
      <section className="rounded-panel border-[1.5px] border-pathway-amber bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl">
            <h2 className="font-heading text-ds-h3 font-bold text-ink">Ready to enter your students?</h2>
            <p className="mt-1 text-sm text-content-secondary">
              Move from the Commons into a specific Campaign to get a deadline, a team workspace, and
              proposal submission.
            </p>
          </div>
          <Button href="/events" variant="primary">
            Browse Campaigns
          </Button>
        </div>
      </section>
    </div>
  )
}
