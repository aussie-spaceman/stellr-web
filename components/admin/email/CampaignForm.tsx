'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { EmailTemplate, Tier, AudienceFilter } from './types'

// Common lifecycle hooks app code can fire via fireCampaignEvent(eventKey, …).
const EVENT_KEYS = [
  { key: 'member.created', label: 'New member joins' },
  { key: 'membership.renewal_7d', label: 'Membership renews in 7 days' },
  { key: 'membership.expired', label: 'Membership expired' },
]

export function CampaignForm({ templates, tiers }: { templates: EmailTemplate[]; tiers: Tier[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [triggerType, setTriggerType] = useState<'scheduled' | 'event'>('scheduled')
  const [scheduledAt, setScheduledAt] = useState('')
  const [eventKey, setEventKey] = useState(EVENT_KEYS[0].key)
  const [activeOnly, setActiveOnly] = useState(true)
  const [excludeMinors, setExcludeMinors] = useState(true)
  const [tierIds, setTierIds] = useState<string[]>([])

  const [count, setCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const audience = (): AudienceFilter => ({ activeOnly, excludeMinors, tierIds: tierIds.length ? tierIds : null })

  const toggleTier = (id: string) =>
    setTierIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))

  const previewCount = async () => {
    setPreviewing(true); setCount(null)
    try {
      const res = await fetch('/api/admin/email/audience/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(audience()),
      })
      const json = await res.json()
      if (res.ok) setCount(json.count)
    } finally {
      setPreviewing(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !templateId) { setError('Name and template are required.'); return }
    if (triggerType === 'scheduled' && !scheduledAt) { setError('Pick a send time.'); return }
    setSubmitting(true); setError(null); setSuccess(false)
    try {
      const res = await fetch('/api/admin/email/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          templateId,
          triggerType,
          scheduledAt: triggerType === 'scheduled' ? new Date(scheduledAt).toISOString() : undefined,
          eventKey: triggerType === 'event' ? eventKey : undefined,
          audience: audience(),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to create campaign.'); return }
      setSuccess(true); setName(''); setScheduledAt(''); setCount(null)
      router.refresh()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const input = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none'

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
      <h2 className="text-base font-semibold text-gray-900">New campaign</h2>

      {templates.length === 0 && (
        <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
          Create a template first — campaigns send a template.
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="June alumni welcome" className={input} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required className={input}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Trigger</label>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={triggerType === 'scheduled'} onChange={() => setTriggerType('scheduled')} /> Scheduled (one-time)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="radio" checked={triggerType === 'event'} onChange={() => setTriggerType('event')} /> Event-triggered
          </label>
        </div>
      </div>

      {triggerType === 'scheduled' ? (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Send at</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
          <p className="mt-1 text-xs text-gray-400">Dispatched on the next hourly cron tick after this time.</p>
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event</label>
          <select value={eventKey} onChange={(e) => setEventKey(e.target.value)} className={input}>
            {EVENT_KEYS.map((k) => <option key={k.key} value={k.key}>{k.label} — {k.key}</option>)}
          </select>
          <p className="mt-1 text-xs text-gray-400">Sends to a member when app code fires this event (still filtered by the audience below).</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-3">
        <p className="text-sm font-medium text-gray-700">Audience</p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active members only
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={excludeMinors} onChange={(e) => setExcludeMinors(e.target.checked)} /> Exclude minors (school students)
        </label>
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Tiers (none selected = all tiers)</p>
          <div className="flex flex-wrap gap-2">
            {tiers.map((t) => (
              <label key={t.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs cursor-pointer ${tierIds.includes(t.id) ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 text-gray-600'}`}>
                <input type="checkbox" className="hidden" checked={tierIds.includes(t.id)} onChange={() => toggleTier(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={previewCount} disabled={previewing} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-50">
            {previewing ? 'Counting…' : 'Preview recipients'}
          </button>
          {count !== null && <span className="text-sm text-gray-700"><strong>{count}</strong> member{count === 1 ? '' : 's'} (after consent suppression)</span>}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Campaign created as draft — activate it from the list below.</p>}

      <button type="submit" disabled={submitting || templates.length === 0} className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create campaign'}
      </button>
    </form>
  )
}
