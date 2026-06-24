'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { ResourceDownloadButton } from '@/components/community/ResourceDownloadButton'
import { FlagModal } from '@/components/community/spaces/FlagModal'

export interface ResourceItem {
  id: string
  title: string
  fileType: string | null
  fromChat: boolean
  sizeBytes: number | null
  createdAt: string
  uploaderName: string | null
}

const TYPE_COLOR: Record<string, { fg: string; bg: string }> = {
  PDF: { fg: '#C0392B', bg: '#FBEAEA' },
  IMG: { fg: '#0E7C88', bg: '#E2F6F8' },
  XLS: { fg: '#1FA97A', bg: '#EDFAF4' },
  DOC: { fg: '#2C53C6', bg: '#EAF0FE' },
  PPT: { fg: '#E0922F', bg: '#FBEFDD' },
  CAD: { fg: '#7C5CFC', bg: '#F6F2FF' },
}

function fmtBytes(n: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ResourcesList({ items }: { items: ResourceItem[] }) {
  const [flagging, setFlagging] = useState<ResourceItem | null>(null)
  const [reported, setReported] = useState<Set<string>>(new Set())

  return (
    <div>
      <div
        className="mb-4 rounded-[12px] px-4 py-3 text-sm"
        style={{ background: '#EAF0FE', color: '#2C53C6' }}
      >
        Files shared in a channel are saved here automatically — look for the <strong>from chat</strong> tag.
      </div>

      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-brand-muted-soft">No resources yet.</p>
      ) : (
        <div className="divide-y divide-brand-hairline rounded-[16px] border border-brand-border bg-white">
          {items.map((r) => {
            const c = (r.fileType && TYPE_COLOR[r.fileType]) || { fg: '#5C637E', bg: '#EEF0F6' }
            const meta = [fmtBytes(r.sizeBytes), r.uploaderName, fmtDate(r.createdAt)].filter(Boolean).join(' · ')
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] text-[10px] font-subheading font-bold"
                  style={{ color: c.fg, background: c.bg }}
                >
                  {r.fileType ?? 'FILE'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-subheading font-semibold text-brand-blue-dark">{r.title}</span>
                    {r.fromChat && (
                      <span className="rounded-full bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-brand-muted-soft">
                        from chat
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-brand-muted-soft">{meta}</p>
                </div>
                {reported.has(r.id) ? (
                  <span className="text-xs" style={{ color: '#C0392B' }}>Reported</span>
                ) : (
                  <button
                    onClick={() => setFlagging(r)}
                    aria-label={`Report ${r.title}`}
                    className="text-brand-muted-soft hover:text-red-500"
                  >
                    <Flag className="h-3.5 w-3.5" />
                  </button>
                )}
                <ResourceDownloadButton resourceId={r.id} title={r.title} />
              </div>
            )
          })}
        </div>
      )}

      {flagging && (
        <FlagModal
          open
          onClose={() => setFlagging(null)}
          contentType="resource"
          contentId={flagging.id}
          label={flagging.title}
          onReported={() => setReported((s) => new Set(s).add(flagging.id))}
        />
      )}
    </div>
  )
}
