'use client'

import { useEffect, useState } from 'react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { AWARD_TYPES, EVENT_AWARDS, type AwardType } from '@/lib/event-awards'
import { ARTWORK_THEME_LABEL, type ArtworkTheme } from '@/lib/artwork-theme'

// Certificate artwork + print, one row per award (lib/event-awards.ts).
// The artwork carries every word; the renderer adds only the recipient's name,
// at a position set per template here and checked against a live preview.
// Who gets which award is set in EventAwards, below this panel.
//
// Two scopes (30 Oct 2026): with `eventSlug`, one event's own artwork, where
// any award without its own uses the theme's default; without, the theme's
// defaults themselves, on Competitions → Default artwork (admins only).

interface Template {
  artwork_path: string
  name_y: number
  name_max_width: number
  name_size: number
  updated_at: string
}

type Templates = Record<AwardType, Template | null>
type Placement = Pick<Template, 'name_y' | 'name_max_width' | 'name_size'>

const DEFAULT_PLACEMENT: Placement = { name_y: 0.545, name_max_width: 0.5, name_size: 40 }

const WHO: Record<AwardType, string> = {
  participation: 'Every student.',
  overall_champion: 'Every student in the winning company.',
  norm_chaffee: 'The champions the volunteer mentors nominate.',
  anita_gale: 'One student per company.',
  dick_edwards: 'One student per company.',
  mentor: 'Every volunteer mentor assigned on the Volunteers panel.',
}

export default function EventCertificates({
  eventSlug, theme, canEditDefaults = false,
}: {
  eventSlug?: string
  theme: ArtworkTheme
  /** Link an admin from the event to the defaults it inherits. */
  canEditDefaults?: boolean
}) {
  const base = eventSlug ? `/api/admin/events/${eventSlug}` : `/api/admin/artwork-defaults/${theme}`
  const themeLabel = ARTWORK_THEME_LABEL[theme]
  const [templates, setTemplates] = useState<Templates | null>(null)
  const [defaults, setDefaults] = useState<Templates | null>(null)
  const [format, setFormat] = useState<'us_letter' | 'a4'>('us_letter')
  const [uploading, setUploading] = useState<AwardType | null>(null)
  const [adjusting, setAdjusting] = useState<AwardType | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)

  async function load() {
    const res = await fetch(`${base}/certificate-templates`)
    if (!res.ok) { setMsg({ text: 'Could not load certificate templates.', error: true }); return }
    const d = (await res.json()) as { templates: Templates; defaults?: Templates }
    setTemplates(d.templates)
    setDefaults(d.defaults ?? null)
  }
  useEffect(() => { void load() }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(award: AwardType, file: File) {
    setUploading(award); setMsg(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const kind = `certificate-${award}`
      const stored = eventSlug
        ? await uploadDirectToStorage(file, 'event-artwork', { slug: eventSlug, kind })
        : await uploadDirectToStorage(file, 'artwork-default', { theme, kind })
      if ('error' in stored) { setMsg({ text: stored.error, error: true }); return }
      const result = await postUpload(
        `${base}/certificate-templates`,
        JSON.stringify({ awardType: award, storagePath: stored.storagePath, fileType: stored.fileType }),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) { setMsg({ text: result.error, error: true }); return }
      setMsg({ text: `${EVENT_AWARDS[award].label} artwork saved. Check where the name lands.` })
      await load()
      setAdjusting(award)
    } finally {
      setUploading(null)
    }
  }

  async function remove(award: AwardType) {
    const label = EVENT_AWARDS[award].label
    const res = await fetch(`${base}/certificate-templates?awardType=${award}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setMsg({ text: d.error ?? `Could not remove the ${label} artwork.`, error: true })
      return
    }
    setMsg({
      text: !eventSlug
        ? `${label}: default removed. Events without their own artwork now have none for it.`
        : defaults?.[award]
          ? `${label}: back to the ${themeLabel} default.`
          : `${label}: artwork removed.`,
    })
    if (adjusting === award) setAdjusting(null)
    await load()
  }

  const download = (award: AwardType | 'all') => `${base}/certificates?award=${award}&format=${format}`
  const anyDefault = AWARD_TYPES.some((t) => defaults?.[t])

  return (
    <div className="bg-white rounded-xl border border-brand-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-muted">Certificates</h3>
          <p className="text-xs text-brand-muted-soft mt-1">
            {eventSlug ? (
              <>
                {anyDefault
                  ? `Each certificate prints on the ${themeLabel} default unless you upload this event’s own artwork.`
                  : `There are no ${themeLabel} defaults yet, so upload this event’s own artwork.`}{' '}
                Only the recipient&rsquo;s name is added, centred in the space you set.
                {canEditDefaults && (
                  <>
                    {' '}
                    <a href={`/admin/competitions/artwork?theme=${theme}`} className="underline hover:text-brand-muted">
                      Change the {themeLabel} defaults
                    </a>
                  </>
                )}
              </>
            ) : (
              <>
                Every {themeLabel} event prints these unless it uploads its own. Only the recipient&rsquo;s name is
                added, centred in the space you set. Replacing one keeps events that have already issued that
                certificate on the artwork they issued it with.
              </>
            )}
          </p>
        </div>
        {eventSlug && (
          <div className="flex items-center gap-2">
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'us_letter' | 'a4')}
              className="border border-line-strong rounded-lg px-2 py-1.5 text-input mouse:text-sm bg-white text-brand-muted"
              aria-label="Paper size"
            >
              <option value="us_letter">US Letter</option>
              <option value="a4">A4</option>
            </select>
            <a href={download('all')} className="inline-block text-sm font-medium bg-brand-blue text-white rounded-lg px-3 py-1.5">
              Download all certificates
            </a>
          </div>
        )}
      </div>

      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}

      <ul className="divide-y divide-brand-hairline border border-brand-border rounded-lg">
        {AWARD_TYPES.map((award) => {
          const t = templates?.[award] ?? null
          const inherited = !t && defaults?.[award] ? defaults[award] : null
          return (
            <li key={award} className="p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-blue-dark text-sm">{EVENT_AWARDS[award].label}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {WHO[award]}{' '}
                    {t ? (
                      <span className="text-green-700">{eventSlug ? 'This event’s own artwork.' : 'Artwork set.'}</span>
                    ) : inherited ? (
                      <span className="text-green-700">Uses the {themeLabel} default.</span>
                    ) : (
                      <span>No artwork yet.</span>
                    )}
                  </p>
                </div>
                <label className="text-xs text-brand-muted-soft cursor-pointer">
                  <span className="underline hover:text-brand-muted">
                    {uploading === award
                      ? 'Uploading…'
                      : t
                        ? 'Replace artwork'
                        : inherited
                          ? 'Upload this event’s own'
                          : 'Upload artwork'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void upload(award, file)
                      e.target.value = ''
                    }}
                  />
                </label>
                {t && (
                  <button
                    type="button"
                    onClick={() => setAdjusting(adjusting === award ? null : award)}
                    className="text-xs font-medium text-brand-blue"
                    aria-expanded={adjusting === award}
                  >
                    {adjusting === award ? 'Close' : 'Position the name'}
                  </button>
                )}
                {t && (
                  <button type="button" onClick={() => void remove(award)} className="text-xs text-brand-muted-soft underline">
                    {eventSlug && defaults?.[award] ? 'Use the default' : 'Remove'}
                  </button>
                )}
                {eventSlug && (t || inherited) && (
                  <a href={download(award)} className="text-xs font-medium px-3 py-1.5 rounded-md border border-brand-border text-brand-blue-dark hover:bg-brand-canvas">
                    Download PDF
                  </a>
                )}
              </div>
              {t && adjusting === award && (
                <NamePositioner
                  key={t.updated_at}
                  base={base}
                  award={award}
                  format={format}
                  initial={t}
                  onSaved={async () => { setMsg({ text: `Name position saved for the ${EVENT_AWARDS[award].label}.` }); await load() }}
                  onError={(text) => setMsg({ text, error: true })}
                />
              )}
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-brand-muted-soft">
        Artwork is best as a landscape PNG, 4:3 or wider. It is scaled to fill the page without stretching, so the
        outer edges may be trimmed slightly (the sides on US Letter, top and bottom on A4).
      </p>
    </div>
  )
}

function NamePositioner({
  base, award, format, initial, onSaved, onError,
}: {
  base: string
  award: AwardType
  format: 'us_letter' | 'a4'
  initial: Placement
  onSaved: () => void | Promise<void>
  onError: (text: string) => void
}) {
  const [p, setP] = useState<Placement>({ name_y: initial.name_y, name_max_width: initial.name_max_width, name_size: initial.name_size })
  const [sample, setSample] = useState('Alexandra Montgomery-Whitfield')
  const [src, setSrc] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-render the preview once the sliders settle, not on every tick.
  useEffect(() => {
    const qs = new URLSearchParams({
      award, format, name: sample,
      name_y: String(p.name_y), name_max_width: String(p.name_max_width), name_size: String(p.name_size),
    })
    const t = setTimeout(() => setSrc(`${base}/certificate-templates/preview?${qs}#toolbar=0&navpanes=0&view=Fit`), 400)
    return () => clearTimeout(t)
  }, [base, award, format, sample, p])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`${base}/certificate-templates`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ awardType: award, ...p }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Save failed')
      await onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
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

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] gap-4 rounded-lg bg-brand-canvas p-3">
      <div className="aspect-[11/8.5] w-full overflow-hidden rounded-md border border-brand-border bg-white">
        {src && <iframe key={src} src={src} title="Certificate preview" className="h-full w-full" />}
      </div>
      <div className="space-y-4">
        <label className="block text-xs text-brand-muted-soft space-y-1">
          <span>Sample name</span>
          <input
            className="w-full rounded-md border border-line-strong px-2 py-1.5 text-input mouse:text-sm text-brand-blue-dark"
            value={sample}
            onChange={(e) => setSample(e.target.value)}
          />
        </label>
        {slider('name_y', 'Height on the page', 0.3, 0.8, 0.005, (v) => `${Math.round(v * 1000) / 10}% down`)}
        {slider('name_max_width', 'Widest the name may run', 0.2, 0.9, 0.01, (v) => `${Math.round(v * 100)}% of width`)}
        {slider('name_size', 'Name size', 16, 72, 1, (v) => `${v} pt`)}
        <p className="text-xs text-brand-muted-soft">Long names shrink to fit the width. Try the longest name on your roster.</p>
        <div className="flex gap-3">
          <button
            type="button" onClick={save} disabled={saving}
            className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save position'}
          </button>
          <button type="button" onClick={() => setP(DEFAULT_PLACEMENT)} className="text-xs text-brand-muted-soft underline">
            Reset to default
          </button>
        </div>
      </div>
    </div>
  )
}
