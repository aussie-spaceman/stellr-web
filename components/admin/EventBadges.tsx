'use client'

import { useEffect, useState } from 'react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { BADGE_FORMATS, DEFAULT_BADGE_FORMAT, type BadgeAudience, type BadgeFormat } from '@/lib/badge-layout'

// Name badges, like EventCertificates: pick the Avery stock, give it a
// background, check where the name lands, download the sheet.
// One background for everyone is enough. Mentors and each company can have
// their own; a badge uses its company's, else the mentors', else everyone's.

const FORMATS = Object.keys(BADGE_FORMATS) as BadgeFormat[]
/** The label's artwork box (bleed included), as literal classes for Tailwind. */
const PREVIEW_ASPECT: Record<BadgeFormat, string> = {
  avery_5392: 'aspect-[4/3]',
  avery_8395: 'aspect-[3.5/2.4583]',
}

interface Template {
  id: string
  format: BadgeFormat
  audience: BadgeAudience
  company_id: string | null
  name_x: number | null
  name_y: number | null
  name_max_width: number | null
  name_size: number | null
  updated_at: string
}

interface Company {
  id: string
  number: number
  name: string | null
}

type Placement = { name_x: number; name_y: number; name_max_width: number; name_size: number }

interface Row {
  key: string
  audience: BadgeAudience
  companyId: string | null
  label: string
  who: string
  /** What these badges use without their own background. */
  fallback: string
}

export default function EventBadges({ eventSlug }: { eventSlug: string }) {
  const base = `/api/admin/events/${eventSlug}`
  const [format, setFormat] = useState<BadgeFormat>(DEFAULT_BADGE_FORMAT)
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [uploading, setUploading] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const spec = BADGE_FORMATS[format]

  async function load() {
    const res = await fetch(`${base}/badge-templates`)
    if (!res.ok) { setMsg({ text: 'Could not load badge backgrounds.', error: true }); return }
    const d = (await res.json()) as { templates: Template[]; companies: Company[] }
    setTemplates(d.templates)
    setCompanies(d.companies)
  }
  useEffect(() => { void load() }, [eventSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  const everyone = templates?.find((t) => t.format === format && t.audience === 'everyone') ?? null
  const mentors = templates?.find((t) => t.format === format && t.audience === 'mentors') ?? null
  const rows: Row[] = [
    { key: 'everyone', audience: 'everyone', companyId: null, label: 'Everyone', who: 'Every badge without its own background below.', fallback: 'Plain badges (name, role, event).' },
    { key: 'mentors', audience: 'mentors', companyId: null, label: 'Mentors', who: 'Optional. Volunteer mentors and anyone registered as a mentor.', fallback: everyone ? 'Uses the Everyone background.' : 'Plain badges.' },
    ...companies.map((c) => ({
      key: `company-${c.id}`,
      audience: 'company' as const,
      companyId: c.id,
      label: c.name ? `Company ${c.number}: ${c.name}` : `Company ${c.number}`,
      who: 'Optional. Every student in this company.',
      fallback: everyone ? 'Uses the Everyone background.' : 'Plain badges.',
    })),
  ]
  const templateFor = (r: Row) =>
    templates?.find((t) => t.format === format && t.audience === r.audience && t.company_id === r.companyId) ?? null

  async function save(r: Row, body: Record<string, unknown>) {
    const res = await fetch(`${base}/badge-templates`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format, audience: r.audience, companyId: r.companyId, ...body }),
    })
    const d = (await res.json()) as { error?: string; lineFound?: boolean | null }
    if (!res.ok) throw new Error(d.error ?? 'Save failed')
    return d
  }

  async function upload(r: Row, file: File) {
    setUploading(r.key); setMsg(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'event-artwork', { slug: eventSlug, kind: spec.artworkKind })
      if ('error' in stored) { setMsg({ text: stored.error, error: true }); return }
      const result = await postUpload(
        `${base}/badge-templates`,
        JSON.stringify({ format, audience: r.audience, companyId: r.companyId, storagePath: stored.storagePath, fileType: stored.fileType }),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) { setMsg({ text: result.error, error: true }); return }
      setMsg(
        result.data.lineFound === false
          ? { text: `${r.label}: background saved, but no horizontal line was found, so the name starts centred. Move it below.`, error: true }
          : { text: `${r.label}: background saved and the name placed on its line. Check it below.` },
      )
      await load()
      setAdjusting(r.key)
    } finally {
      setUploading(null)
    }
  }

  async function remove(r: Row, t: Template) {
    const res = await fetch(`${base}/badge-templates?id=${t.id}`, { method: 'DELETE' })
    if (!res.ok) { setMsg({ text: 'Could not remove that background.', error: true }); return }
    setMsg({ text: `${r.label}: background removed. ${r.fallback}` })
    if (adjusting === r.key) setAdjusting(null)
    await load()
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-muted uppercase tracking-wide">Name badges</h3>
          <p className="text-xs text-brand-muted-soft mt-1">
            One badge for every student and volunteer mentor, full name on one line. One background for everyone is
            enough; give mentors or a company their own to tell them apart.
          </p>
        </div>
        <a
          href={`${base}/badges?format=${format}`}
          className="inline-block text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5"
        >
          Download {spec.label} PDF
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Avery product" className="inline-flex rounded-lg border border-brand-border p-0.5">
          {FORMATS.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={f === format}
              onClick={() => { setFormat(f); setAdjusting(null); setMsg(null) }}
              className={`text-sm font-medium rounded-md px-3 py-1.5 ${
                f === format ? 'bg-brand-blue text-white' : 'text-brand-blue-dark hover:bg-brand-canvas'
              }`}
            >
              {BADGE_FORMATS[f].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-brand-muted-soft">{spec.description}. Each product has its own backgrounds.</p>
      </div>

      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}

      <ul className="divide-y divide-brand-hairline border border-brand-border rounded-lg">
        {rows.map((r) => {
          const t = templateFor(r)
          return (
            <li key={r.key} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-blue-dark text-sm">{r.label}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {r.who}{' '}
                    {t ? <span className="text-green-700">Background set.</span> : <span>{r.fallback}</span>}
                  </p>
                </div>
                <label className="text-xs text-brand-muted-soft cursor-pointer">
                  <span className="underline hover:text-brand-muted">
                    {uploading === r.key ? 'Uploading…' : t ? 'Replace background' : 'Upload background'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void upload(r, file)
                      e.target.value = ''
                    }}
                  />
                </label>
                {t && (
                  <button
                    type="button"
                    onClick={() => setAdjusting(adjusting === r.key ? null : r.key)}
                    className="text-xs font-medium text-brand-blue"
                    aria-expanded={adjusting === r.key}
                  >
                    {adjusting === r.key ? 'Close' : 'Position the name'}
                  </button>
                )}
                {t && (
                  <button type="button" onClick={() => void remove(r, t)} className="text-xs text-brand-muted-soft underline">
                    Remove
                  </button>
                )}
              </div>
              {t && adjusting === r.key && t.name_x !== null && (
                <NamePositioner
                  key={t.updated_at}
                  base={base}
                  template={t}
                  onSave={async (body) => {
                    try {
                      const d = await save(r, body)
                      setMsg(
                        body.reset && d.lineFound === false
                          ? { text: `${r.label}: no horizontal line found, so the name is centred.`, error: true }
                          : { text: `${r.label}: name position saved.` },
                      )
                      await load()
                    } catch (e) {
                      setMsg({ text: e instanceof Error ? e.message : 'Save failed', error: true })
                    }
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-brand-muted-soft">
        Backgrounds are best as a landscape PNG in the label&rsquo;s shape. They are cropped to fit, never stretched.
        {companies.length === 0 && ' Add companies on the Companies tab to give each its own background.'} Print at 100%
        (actual size), not &ldquo;fit to page&rdquo;.
      </p>
    </div>
  )
}

function NamePositioner({
  base, template, onSave,
}: {
  base: string
  template: Template
  onSave: (body: Record<string, unknown>) => Promise<void>
}) {
  const spec = BADGE_FORMATS[template.format]
  const [p, setP] = useState<Placement>({
    name_x: template.name_x ?? 0.5,
    name_y: template.name_y ?? 0.55,
    name_max_width: template.name_max_width ?? 0.8,
    name_size: template.name_size ?? spec.maxNameSize,
  })
  const [sample, setSample] = useState('Alexandra Montgomery-Whitfield')
  const [src, setSrc] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-render the preview once the sliders settle, not on every tick.
  useEffect(() => {
    const qs = new URLSearchParams({
      id: template.id, name: sample,
      name_x: String(p.name_x), name_y: String(p.name_y),
      name_max_width: String(p.name_max_width), name_size: String(p.name_size),
    })
    const t = setTimeout(() => setSrc(`${base}/badge-templates/preview?${qs}#toolbar=0&navpanes=0&view=Fit`), 400)
    return () => clearTimeout(t)
  }, [base, template.id, sample, p])

  async function run(body: Record<string, unknown>) {
    setSaving(true)
    try { await onSave(body) } finally { setSaving(false) }
  }

  const slider = (key: keyof Placement, label: string, min: number, max: number, step: number, show: (v: number) => string) => (
    <label className="block text-xs text-brand-muted-soft space-y-1">
      <span className="flex justify-between"><span>{label}</span><span className="text-brand-muted">{show(p[key])}</span></span>
      <input
        type="range" min={min} max={max} step={step} value={p[key]}
        onChange={(e) => setP({ ...p, [key]: Number(e.target.value) })}
        className="w-full accent-brand-blue"
      />
    </label>
  )
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] gap-4 rounded-lg bg-brand-canvas p-3">
      <div className={`w-full overflow-hidden rounded-md border border-brand-border bg-white ${PREVIEW_ASPECT[template.format]}`}>
        {src && <iframe key={src} src={src} title="Badge preview" className="h-full w-full" />}
      </div>
      <div className="space-y-4">
        <label className="block text-xs text-brand-muted-soft space-y-1">
          <span>Sample name</span>
          <input
            className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm text-brand-blue-dark"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
        </label>
        {slider('name_y', 'Height on the badge', 0.15, 0.9, 0.005, (v) => `${pct(v)} down`)}
        {slider('name_x', 'Across', 0.2, 0.8, 0.005, (v) => `${pct(v)} across`)}
        {slider('name_max_width', 'Widest the name may run', 0.2, 1, 0.01, (v) => `${Math.round(v * 100)}% of width`)}
        {slider('name_size', 'Name size', 8, 40, 1, (v) => `${v} pt`)}
        <p className="text-xs text-brand-muted-soft">Long names shrink to fit the width. Try the longest name on your roster.</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button" onClick={() => void run({ ...p })} disabled={saving}
            className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save position'}
          </button>
          <button type="button" onClick={() => void run({ reset: true })} disabled={saving} className="text-xs text-brand-muted-soft underline">
            Put it back on the line
          </button>
        </div>
      </div>
    </div>
  )
}
