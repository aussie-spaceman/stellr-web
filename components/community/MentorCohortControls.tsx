'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarRange, BookOpen, Plus, X, Loader2 } from 'lucide-react'

interface LinkedTraining {
  moduleId: string
  title: string
  isMandatory: boolean
  dueAt: string | null
}

interface AvailableModule {
  id: string
  title: string
}

export function MentorCohortControls({
  cohortId,
  modules,
  linkedTraining,
}: {
  cohortId: string
  modules: AvailableModule[]
  linkedTraining: LinkedTraining[]
}) {
  const router = useRouter()
  const onUpdate = () => router.refresh()
  return (
    <section className="space-y-6 rounded-lg border border-purple-100 bg-purple-50/30 p-5">
      <h2 className="text-sm font-subheading font-semibold uppercase tracking-wide text-purple-700">Mentor controls</h2>
      <SeriesScheduler cohortId={cohortId} onUpdate={onUpdate} />
      <TrainingAssigner
        cohortId={cohortId}
        modules={modules}
        linkedTraining={linkedTraining}
        onUpdate={onUpdate}
      />
    </section>
  )
}

function SeriesScheduler({ cohortId, onUpdate }: { cohortId: string; onUpdate: () => void }) {
  const [open, setOpen] = useState(false)
  const [startIso, setStartIso] = useState('')
  const [count, setCount] = useState(4)
  const [intervalDays, setIntervalDays] = useState(7)
  const [durationMin, setDurationMin] = useState(60)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const submit = async () => {
    if (!startIso) return
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/community/mentoring/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohortId,
          action: 'scheduleSeries',
          startIso,
          count,
          intervalDays,
          durationMin,
          title: title || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult(`${json.created ?? count} sessions scheduled.`)
        setOpen(false)
        onUpdate()
      } else {
        setResult(json.error ?? 'Failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-700 hover:text-purple-900"
      >
        <CalendarRange className="h-4 w-4" />
        Schedule session series
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-md border border-brand-border bg-white p-4">
          <label className="block text-sm">
            <span className="font-medium text-brand-muted">First session</span>
            <input
              type="datetime-local"
              value={startIso}
              onChange={(e) => setStartIso(e.target.value)}
              className="mt-1 block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
            />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-brand-muted">Sessions</span>
              <input
                type="number"
                min={1}
                max={52}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-brand-muted">Every N days</span>
              <input
                type="number"
                min={1}
                max={90}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-brand-muted">Duration (min)</span>
              <input
                type="number"
                min={15}
                max={180}
                step={15}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-brand-muted">Title (optional)</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Mentoring session"
              className="mt-1 block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
            />
          </label>
          <button
            onClick={submit}
            disabled={busy || !startIso}
            className="inline-flex items-center gap-1.5 rounded-md bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-800 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Schedule
          </button>
        </div>
      )}

      {result && <p className="mt-2 text-sm text-brand-muted">{result}</p>}
    </div>
  )
}

function TrainingAssigner({
  cohortId,
  modules,
  linkedTraining,
  onUpdate,
}: {
  cohortId: string
  modules: AvailableModule[]
  linkedTraining: LinkedTraining[]
  onUpdate: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [selectedModule, setSelectedModule] = useState('')
  const [mandatory, setMandatory] = useState(false)
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)

  const linkedIds = new Set(linkedTraining.map((t) => t.moduleId))
  const available = modules.filter((m) => !linkedIds.has(m.id))

  const link = async () => {
    if (!selectedModule) return
    setBusy(true)
    try {
      await fetch('/api/community/mentoring/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cohortId,
          action: 'linkTraining',
          moduleId: selectedModule,
          mandatory,
          dueAt: dueAt || null,
        }),
      })
      setAdding(false)
      setSelectedModule('')
      setMandatory(false)
      setDueAt('')
      onUpdate()
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (moduleId: string) => {
    await fetch('/api/community/mentoring/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cohortId, action: 'unlinkTraining', moduleId }),
    })
    onUpdate()
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-purple-700" />
        <span className="text-sm font-medium text-purple-700">Training material</span>
      </div>

      {linkedTraining.length > 0 && (
        <ul className="mt-2 space-y-1">
          {linkedTraining.map((t) => (
            <li key={t.moduleId} className="flex items-center justify-between rounded-md bg-white px-3 py-1.5 text-sm">
              <span>
                {t.title}
                <span className={`ml-2 text-xs ${t.isMandatory ? 'text-brand-gold-ink' : 'text-brand-muted-soft'}`}>
                  {t.isMandatory ? 'Mandatory' : 'Optional'}
                </span>
                {t.dueAt && (
                  <span className="ml-2 text-xs text-brand-muted-soft">
                    due {new Date(t.dueAt).toLocaleDateString()}
                  </span>
                )}
              </span>
              <button
                onClick={() => unlink(t.moduleId)}
                className="text-brand-muted-soft hover:text-red-500"
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!adding && available.length > 0 && (
        <button
          onClick={() => setAdding(true)}
          className="mt-2 inline-flex items-center gap-1 text-sm text-purple-600 hover:text-purple-800"
        >
          <Plus className="h-3.5 w-3.5" /> Add training module
        </button>
      )}

      {adding && (
        <div className="mt-2 space-y-2 rounded-md border border-brand-border bg-white p-3">
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="block w-full rounded-md border border-brand-border px-3 py-1.5 text-sm"
          >
            <option value="">Select a module…</option>
            {available.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
              Mandatory
            </label>
            <label className="block text-sm">
              <span className="text-brand-muted">Due:</span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="ml-1 rounded-md border border-brand-border px-2 py-1 text-sm"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={link}
              disabled={busy || !selectedModule}
              className="rounded-md bg-purple-700 px-3 py-1 text-sm font-medium text-white hover:bg-purple-800 disabled:opacity-50"
            >
              Add
            </button>
            <button onClick={() => setAdding(false)} className="text-sm text-brand-muted-soft hover:text-brand-muted">
              Cancel
            </button>
          </div>
        </div>
      )}

      {available.length === 0 && linkedTraining.length === 0 && (
        <p className="mt-2 text-sm text-brand-muted-soft">No training modules available to assign.</p>
      )}
    </div>
  )
}
