import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getResourceDetail } from '@/lib/resources-catalogue'
import { ResourceDetailHeader } from '@/components/community/resources/ResourceDetailHeader'
import { ResourceFlagButton } from '@/components/community/resources/ResourceFlagButton'

export const metadata = { title: 'Community · Resource' }

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function typeLabel(kind: string, fileType: string | null): string {
  if (kind === 'video') return 'Recording'
  if (kind === 'link') return 'Link'
  return fileType?.split('/')[1]?.toUpperCase() ?? 'File'
}

// Resource detail (handover §4.2). Header + the "How you have access" provenance
// panel (every container this member can reach the binary through) + a facts
// table. The flag UI lands in PR3 — the section is anchored here so the header's
// Report button has a target.
export default async function ResourceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { id } = await params
  const detail = await getResourceDetail(member, id)
  if (!detail) notFound()

  const added = new Date(detail.addedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

  return (
    <div className="max-w-3xl">
      <Link
        href="/community/resources"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-brand-muted-soft hover:text-brand-blue-dark"
      >
        <ArrowLeft className="h-4 w-4" />
        All resources
      </Link>

      <ResourceDetailHeader
        attachmentId={id}
        initialName={detail.name}
        kind={detail.kind}
        canRename={detail.canRename}
      />

      {/* How you have access */}
      <section className="mt-8 rounded-2xl border border-brand-border bg-white p-5">
        <h2 className="font-heading text-sm uppercase tracking-wide text-brand-blue-dark">How you have access</h2>
        <ul className="mt-3 space-y-2">
          {detail.attachments.map((a) => (
            <li key={a.attachmentId} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-brand-muted">
                {a.provenance.href ? (
                  <Link href={a.provenance.href} className="font-medium text-brand-blue-dark hover:underline">
                    {a.provenance.label}
                  </Link>
                ) : (
                  <span className="font-medium text-brand-blue-dark">{a.provenance.label}</span>
                )}
                <span className="ml-2 capitalize text-brand-muted-soft">· {a.provenance.visibility}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-brand-muted-soft">
          One stored file, attached to {detail.attachments.length}{' '}
          {detail.attachments.length === 1 ? 'object' : 'objects'} — removing it from one object won’t delete it
          elsewhere.
        </p>
      </section>

      {/* Facts */}
      <section className="mt-4 rounded-2xl border border-brand-border bg-white p-5">
        <dl className="grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-muted-soft">Type</dt>
            <dd className="text-brand-blue-dark">{typeLabel(detail.kind, detail.fileType)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-muted-soft">Size</dt>
            <dd className="text-brand-blue-dark">{formatBytes(detail.fileSizeBytes)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-muted-soft">Uploaded by</dt>
            <dd className="text-brand-blue-dark">{detail.uploadedByName ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-muted-soft">Added</dt>
            <dd className="text-brand-blue-dark">{added}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-brand-muted-soft">Opens</dt>
            <dd className="text-brand-blue-dark">{detail.downloadCount}</dd>
          </div>
        </dl>
        {detail.description && <p className="mt-4 text-sm text-brand-muted">{detail.description}</p>}
      </section>

      {/* Flag — reuses the shared chat moderation pipeline (community_flags). */}
      <section id="flag-section" className="mt-4 rounded-2xl border border-brand-border bg-white p-5">
        <h2 className="font-heading text-sm uppercase tracking-wide text-brand-blue-dark">Report a problem</h2>
        <p className="mb-3 mt-1 text-sm text-brand-muted-soft">
          Reports go to the moderation team. Tell us what’s wrong with this resource.
        </p>
        <ResourceFlagButton binaryId={detail.binaryId} containerRef={detail.viewedInContainerId} />
      </section>
    </div>
  )
}
