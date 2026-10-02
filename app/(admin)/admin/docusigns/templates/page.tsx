import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Badge } from '@stellr/web-ui'
import { supabaseServer } from '@/lib/supabase'
import { formatDateShort } from '@/lib/utils'
import { parseFieldMap } from '@/lib/esign/native/template'

export const metadata = { title: 'Admin — Agreement documents' }

// The documents Stellr signing sends, every version. Picking one shows the
// stored PDF beside the same PDF with each field's label printed where the
// field sits, and the field list, so a version can be checked before it is
// approved with `scripts/esign-template.ts approve`.

interface VersionRow {
  id: string
  key: string
  version: number
  title: string
  pdf_sha256: string
  page_count: number | null
  field_map: unknown
  approved_by: string | null
  approved_at: string | null
  active: boolean
  created_at: string
}

const SOURCE_LABEL: Record<string, string> = {
  prefill: 'Filled in from registration',
  signer: 'Signer enters',
  system: 'Added on signing',
}

export default async function AgreementTemplatesPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  const { data } = await supabaseServer()
    .from('esign_templates')
    .select('id, key, version, title, pdf_sha256, page_count, field_map, approved_by, approved_at, active, created_at')
    .order('key')
    .order('version', { ascending: false })
  const versions = (data ?? []) as VersionRow[]
  const { v } = await searchParams
  const selected = versions.find((r) => r.id === v) ?? null
  const fields = selected ? parseFieldMap(selected.field_map).fields : []

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm">
          <Link href="/admin/docusigns" className="text-primary underline">Consent forms</Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-ink">Agreement documents</h1>
        <p className="mt-0.5 text-sm text-content-muted">
          The documents Stellr signing sends. A version is used only once it is approved; approved versions never change.
        </p>
      </div>

      <section className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-content-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-semibold">Document</th>
              <th className="px-4 py-2 font-semibold">Version</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Fields</th>
              <th className="px-4 py-2 font-semibold">Published</th>
              <th className="px-4 py-2 font-semibold">Fingerprint</th>
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-content-muted">No documents are published yet.</td></tr>
            )}
            {versions.map((r) => (
              <tr key={r.id} className={`border-b border-line last:border-0 ${r.id === selected?.id ? 'bg-surface' : ''}`}>
                <td className="px-4 py-2">
                  <Link href={`/admin/docusigns/templates?v=${r.id}`} className="font-semibold text-primary underline">{r.title}</Link>
                  <span className="ml-2 text-xs text-content-muted">{r.key}</span>
                </td>
                <td className="px-4 py-2 text-ink">v{r.version}</td>
                <td className="px-4 py-2">
                  {r.active && r.approved_at ? <Badge>In use</Badge>
                    : r.active ? <Badge className="bg-pathway-amber-bg text-brand-gold-ink">In use on dev, not approved</Badge>
                    : r.approved_at ? <span className="text-content-muted">Approved, not in use</span>
                    : <span className="text-content-muted">Draft</span>}
                </td>
                <td className="px-4 py-2 text-ink">{parseFieldMap(r.field_map).fields.length}</td>
                <td className="px-4 py-2 text-ink">{formatDateShort(r.created_at)}</td>
                <td className="px-4 py-2 font-mono text-xs text-content-muted">{r.pdf_sha256.slice(0, 12)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected && (
        <section className="space-y-4" aria-labelledby="preview-heading">
          <div>
            <h2 id="preview-heading" className="font-heading text-lg font-semibold text-ink">
              {`${selected.title}, version ${selected.version}`}
            </h2>
            <p className="text-sm text-content-muted">
              {selected.approved_at
                ? `Approved by ${selected.approved_by ?? 'unknown'} on ${formatDateShort(selected.approved_at)}.`
                : 'Not approved. Check both copies and every field below, then approve with scripts/esign-template.ts.'}
              {` SHA-256 ${selected.pdf_sha256}.`}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <figure className="space-y-2">
              <figcaption className="text-sm font-semibold text-ink">As signers see it</figcaption>
              <iframe
                title={`${selected.title} as signers see it`}
                src={`/api/admin/esign/templates/${selected.id}/preview?as=blank`}
                className="h-[75vh] w-full rounded-xl border border-line bg-white"
              />
            </figure>
            <figure className="space-y-2">
              <figcaption className="text-sm font-semibold text-ink">Where each field prints</figcaption>
              <iframe
                title={`${selected.title} with field labels`}
                src={`/api/admin/esign/templates/${selected.id}/preview?as=labels`}
                className="h-[75vh] w-full rounded-xl border border-line bg-white"
              />
            </figure>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-white">
            <table className="w-full text-sm">
              <thead className="text-left text-content-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 font-semibold">Field</th>
                  <th className="px-4 py-2 font-semibold">Who</th>
                  <th className="px-4 py-2 font-semibold">Kind</th>
                  <th className="px-4 py-2 font-semibold">Where the value comes from</th>
                  <th className="px-4 py-2 font-semibold">Position</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.name} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 text-ink">
                      {f.label}
                      {f.required && <span className="text-danger"> *</span>}
                      <span className="block font-mono text-xs text-content-muted">{f.name}</span>
                    </td>
                    <td className="px-4 py-2 text-ink">{f.role}</td>
                    <td className="px-4 py-2 text-ink">{f.type.replace('_', ' ')}</td>
                    <td className="px-4 py-2 text-ink">
                      {SOURCE_LABEL[f.source] ?? f.source}
                      {f.prefillKey && <span className="block font-mono text-xs text-content-muted">{f.prefillKey}</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-content-muted">{`p${f.page} @${f.x},${f.y}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
