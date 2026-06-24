import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { resolveTierMap } from '@/lib/tiers-server'
import { ResourceUploadForm } from '@/components/admin/community/ResourceUploadForm'
import { ResourceRowActions } from '@/components/admin/community/ResourceRowActions'
import { FileText } from 'lucide-react'

export const metadata = { title: 'Admin — Community Resources' }

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function AdminCommunityResourcesPage() {
  const db = supabaseServer()
  const [{ data: resources }, { data: spaces }, { data: resourceTiers }, tierMap] = await Promise.all([
    db
      .from('community_resources')
      .select('id, title, description, file_type, file_size_bytes, min_tier_rank, created_at, community_spaces(name)')
      .order('created_at', { ascending: false }),
    db
      .from('community_spaces')
      .select('id, name')
      .eq('is_archived', false)
      .order('display_order'),
    db.from('community_resource_tiers').select('resource_id, tier_id'),
    resolveTierMap(),
  ])

  // Map each resource → its per-tier allowlist (empty = open to all).
  const tiersByResource = new Map<string, string[]>()
  for (const r of (resourceTiers ?? []) as { resource_id: string; tier_id: string }[]) {
    tiersByResource.set(r.resource_id, [...(tiersByResource.get(r.resource_id) ?? []), r.tier_id])
  }
  const allTiers = tierMap.rows.map((t) => ({ id: t.id, name: t.name }))

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue" /> Community
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Community Resources</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          {(resources ?? []).length} resources · Upload files for members to access
        </p>
      </div>

      <ResourceUploadForm spaces={spaces ?? []} />

      <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-hairline bg-brand-canvas text-left">
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Title</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Space</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Size</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Added</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Access &amp; actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-hairline">
            {(resources ?? []).map((r) => {
              const space = Array.isArray(r.community_spaces)
                ? r.community_spaces[0]
                : r.community_spaces
              return (
                <tr key={r.id} className="hover:bg-brand-canvas">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                      <div>
                        <p className="font-medium text-brand-blue-dark">{r.title}</p>
                        {r.description && (
                          <p className="text-xs text-brand-muted-soft line-clamp-1">{r.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{(space as { name: string } | null)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-brand-muted-soft">{formatBytes(r.file_size_bytes)}</td>
                  <td className="px-4 py-3 text-brand-muted-soft">
                    {formatDateShort(r.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <ResourceRowActions
                      resourceId={r.id}
                      allTiers={allTiers}
                      assignedTierIds={tiersByResource.get(r.id) ?? []}
                    />
                  </td>
                </tr>
              )
            })}
            {(!resources || resources.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-brand-muted-soft">
                  No resources uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
