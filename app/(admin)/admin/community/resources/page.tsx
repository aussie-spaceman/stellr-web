import Link from 'next/link'
import { FileText, Link as LinkIcon, PlayCircle, Database, HardDrive, Copy, Flag } from 'lucide-react'
import { formatDateShort } from '@/lib/utils'
import { getAdminResourceIndex } from '@/lib/resource-admin'
import { ResourceUploadForm } from '@/components/admin/community/ResourceUploadForm'
import { AdminBinaryActions } from '@/components/admin/community/AdminBinaryActions'

export const metadata = { title: 'Admin — Community Resources' }

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function typeLabel(fileType: string | null, isLink: boolean): string {
  if (isLink) return 'Link'
  if (fileType?.startsWith('video/')) return 'Video'
  return fileType?.split('/')[1]?.toUpperCase() ?? 'File'
}

// Central resource management (handover §4.6). ONE row per stored binary with a
// volume/dedup stat strip. The legacy "Space" column and "Download Access" filter
// are gone — access lives on the container, not the file. The upload form remains
// the admin path that creates a binary unconditionally (the force-duplicate
// override, decision 5).
export default async function AdminCommunityResourcesPage() {
  const { rows, stats } = await getAdminResourceIndex()

  const statCards = [
    { icon: <Database className="h-4 w-4" />, label: 'Stored binaries', value: String(stats.binaryCount) },
    { icon: <HardDrive className="h-4 w-4" />, label: 'Total volume', value: formatBytes(stats.totalBytes) },
    { icon: <Copy className="h-4 w-4" />, label: 'Duplicates prevented', value: String(stats.duplicatesPrevented) },
    { icon: <Flag className="h-4 w-4" />, label: 'Open flags', value: String(stats.openFlags) },
  ]

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue" /> Community
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Community Resources</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          One row per stored file. Access is inherited from the object a resource is attached to.
        </p>
      </div>

      {/* Stat strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        {statCards.map((s) => (
          <div key={s.label} className="rounded-xl border border-brand-border bg-white p-4">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">
              {s.icon} {s.label}
            </p>
            <p className="mt-1.5 font-heading text-2xl text-brand-blue-dark">{s.value}</p>
          </div>
        ))}
      </div>

      <ResourceUploadForm />

      <div className="overflow-hidden rounded-xl border border-brand-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-hairline bg-brand-canvas text-left">
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Resource</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Type</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Size</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Attached to</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Opens</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-hairline">
            {rows.map((r) => {
              const Icon = r.isLink ? LinkIcon : r.fileType?.startsWith('video/') ? PlayCircle : FileText
              return (
                <tr key={r.id} className="hover:bg-brand-canvas">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-brand-blue-dark">{r.title}</p>
                          {r.pendingFlags > 0 && (
                            <Link
                              href="/admin/community/moderation"
                              className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600"
                            >
                              {r.pendingFlags} flag{r.pendingFlags === 1 ? '' : 's'}
                            </Link>
                          )}
                        </div>
                        <p className="text-xs text-brand-muted-soft">
                          {r.source === 'training'
                            ? r.fileType?.startsWith('video/')
                              ? 'Lesson recording'
                              : 'Lesson resource'
                            : r.uploaderName ?? 'Unknown'}{' '}
                          · {formatDateShort(r.createdAt)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{typeLabel(r.fileType, r.isLink)}</td>
                  <td className="px-4 py-3 text-brand-muted-soft">
                    {r.isLink || r.sizeBytes == null ? '—' : formatBytes(r.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-brand-muted">
                    {r.source === 'training'
                      ? r.attachedObjects[0] ?? '—'
                      : `${r.attachedCount} object${r.attachedCount === 1 ? '' : 's'}`}
                  </td>
                  <td className="px-4 py-3 text-brand-muted-soft">{r.source === 'training' ? '—' : r.downloads}</td>
                  <td className="px-4 py-3">
                    {r.source === 'training' ? (
                      r.builderHref ? (
                        <div className="flex justify-end">
                          <Link
                            href={r.builderHref}
                            className="text-xs font-medium text-brand-blue-dark hover:underline"
                          >
                            View in course
                          </Link>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-brand-muted-soft">Managed in course</p>
                      )
                    ) : (
                      <AdminBinaryActions binaryId={r.id} title={r.title} attachedObjects={r.attachedObjects} />
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-brand-muted-soft">
                  No resources yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
