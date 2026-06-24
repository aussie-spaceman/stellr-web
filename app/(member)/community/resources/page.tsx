import { redirect } from 'next/navigation'
import { FileText, Lock } from 'lucide-react'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember, memberCanAccess, resourceTierAllowed } from '@/lib/community'
import { ResourceDownloadButton } from '@/components/community/ResourceDownloadButton'

export const metadata = { title: 'Community · Resources' }

interface ResourceRow {
  id: string
  title: string
  description: string | null
  file_type: string | null
  file_size_bytes: number | null
  min_tier_rank: number
  created_at: string
  community_spaces: { name: string } | { name: string }[] | null
}

function spaceName(rel: ResourceRow['community_spaces']): string | null {
  const s = Array.isArray(rel) ? rel[0] : rel
  return s?.name ?? null
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Resource library (FR-COM-03).
// All authenticated members see every resource title + description.
// Download button is gated: free-tier members see an upgrade prompt for
// resources where min_tier_rank > 0 (FR-COM-08).
export default async function ResourcesPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const db = supabaseServer()
  const { data: resources } = await db
    .from('community_resources')
    .select('id, title, description, file_type, file_size_bytes, min_tier_rank, created_at, community_spaces(name)')
    .order('created_at', { ascending: false })

  // Access-Map-aware download eligibility, resolved once for the render loop.
  const downloadableIds = new Set<string>()
  await Promise.all(
    (resources ?? []).map(async (r) => {
      const id = (r as ResourceRow).id
      const [tierOk, accessOk] = await Promise.all([
        resourceTierAllowed(member, id),
        memberCanAccess(member, 'resource', id, (r as ResourceRow).min_tier_rank, 'download'),
      ])
      if (tierOk && accessOk) downloadableIds.add(id)
    }),
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Resources</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Documents, past competition papers, and study guides.
          {!member.hasPaidTier && (
            <span className="ml-1 text-brand-gold-ink">
              <a href="/account?tab=billing" className="underline">Upgrade</a> to unlock downloads.
            </span>
          )}
        </p>
      </div>

      {(!resources || resources.length === 0) && (
        <p className="text-sm text-brand-muted-soft">No resources yet. Check back soon.</p>
      )}

      <ul className="space-y-3">
        {(resources ?? []).map((resource: ResourceRow) => {
          const canDownload = downloadableIds.has(resource.id)
          const space = spaceName(resource.community_spaces)

          return (
            <li
              key={resource.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-brand-border bg-white p-4"
            >
              <div className="flex min-w-0 items-start gap-3">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand-muted-soft" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-brand-blue-dark">{resource.title}</h2>
                    {resource.min_tier_rank > 0 && (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-brand-gold-ink" />
                    )}
                  </div>
                  {resource.description && (
                    <p className="mt-0.5 text-sm text-brand-muted-soft">{resource.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-muted-soft">
                    {space && <span>{space}</span>}
                    {resource.file_type && <span>{resource.file_type.split('/')[1]?.toUpperCase()}</span>}
                    {resource.file_size_bytes && <span>{formatBytes(resource.file_size_bytes)}</span>}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                {canDownload ? (
                  <ResourceDownloadButton resourceId={resource.id} title={resource.title} />
                ) : (
                  <a
                    href="/account?tab=billing"
                    className="inline-block rounded-md border border-brand-orange bg-brand-orange/5 px-3 py-1.5 text-xs font-medium text-brand-gold-ink hover:bg-brand-orange/10"
                  >
                    Upgrade to download
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
