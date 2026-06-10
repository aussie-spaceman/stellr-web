import { supabaseServer } from '@/lib/supabase'
import { ResourceUploadForm } from '@/components/admin/community/ResourceUploadForm'
import { FileText, Lock } from 'lucide-react'

export const metadata = { title: 'Admin — Community Resources' }

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function AdminCommunityResourcesPage() {
  const db = supabaseServer()
  const [{ data: resources }, { data: spaces }] = await Promise.all([
    db
      .from('community_resources')
      .select('id, title, description, file_type, file_size_bytes, min_tier_rank, created_at, community_spaces(name)')
      .order('created_at', { ascending: false }),
    db
      .from('community_spaces')
      .select('id, name')
      .eq('is_archived', false)
      .order('display_order'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Community Resources</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {(resources ?? []).length} resources · Upload files for members to access
        </p>
      </div>

      <ResourceUploadForm spaces={spaces ?? []} />

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-left">
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">Title</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">Space</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">Access</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">Size</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(resources ?? []).map((r) => {
              const space = Array.isArray(r.community_spaces)
                ? r.community_spaces[0]
                : r.community_spaces
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                      <div>
                        <p className="font-medium text-gray-900">{r.title}</p>
                        {r.description && (
                          <p className="text-xs text-gray-400 line-clamp-1">{r.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{(space as { name: string } | null)?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.min_tier_rank > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Lock className="h-3 w-3" /> Paid only
                      </span>
                    ) : (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        All members
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatBytes(r.file_size_bytes)}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                </tr>
              )
            })}
            {(!resources || resources.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
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
