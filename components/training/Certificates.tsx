import { Award, Download } from 'lucide-react'
import { themeAccent, TYPE_META } from '@/lib/training'
import type { Certificate } from '@/lib/training-portal'
import { EmptyState } from '@/components/ui/EmptyState'
import { ShareCertButton } from './ShareCertButton'

// Completion certificates grid: theme-colour spine, award icon, type pill, title,
// issuer + date, Download PDF + Share.

function issuedLabel(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

function CertCard({ c }: { c: Certificate }) {
  const accent = themeAccent(c.theme)
  const type = TYPE_META[c.type]
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border border-brand-border bg-white"
      style={{ borderLeft: `5px solid ${accent.color}` }}
    >
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-xl"
            style={{ background: accent.tint, color: accent.ink }}
          >
            <Award className="h-6 w-6" />
          </span>
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ background: type.tint, color: type.ink }}
          >
            {type.short}
          </span>
        </div>
        <h3 className="text-base font-semibold leading-snug text-brand-blue-dark">{c.title}</h3>
        <p className="text-xs text-brand-muted-soft">
          Issued {issuedLabel(c.issuedAt)} · {c.issuer}
        </p>
        <p className="text-[11px] text-brand-muted-soft">No. {c.certNumber}</p>
        <div className="mt-auto flex items-center gap-2 pt-2">
          <a
            href={`/api/community/training/certificates/${c.id}/pdf`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright"
          >
            <Download className="h-4 w-4" /> Download PDF
          </a>
          <ShareCertButton certNumber={c.certNumber} />
        </div>
      </div>
    </div>
  )
}

export function Certificates({ certificates }: { certificates: Certificate[] }) {
  if (certificates.length === 0) {
    return (
      <EmptyState
        title="No certificates yet"
        hint="Complete a course to earn your first certificate — it appears here automatically."
      />
    )
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {certificates.map((c) => (
        <CertCard key={c.id} c={c} />
      ))}
    </div>
  )
}
