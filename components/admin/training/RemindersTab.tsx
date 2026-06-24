'use client'

import { useState } from 'react'
import { Bell, Mail, MessageSquare } from 'lucide-react'

// Per-course reminder & escalation settings with a live preview. Settings are
// stored on the Course (training_modules); the selector scopes them to one course.

export interface ReminderSettings {
  remind_inapp: boolean
  remind_email: boolean
  remind_sms: boolean
  remind_2wk: boolean
  remind_1wk: boolean
  remind_2d: boolean
  remind_1d: boolean
  escalate_supervisor: boolean
}
export interface ReminderCourse {
  id: string
  title: string
  settings: ReminderSettings
}

const API_KEY: Record<keyof ReminderSettings, string> = {
  remind_inapp: 'remindInapp',
  remind_email: 'remindEmail',
  remind_sms: 'remindSms',
  remind_2wk: 'remind2wk',
  remind_1wk: 'remind1wk',
  remind_2d: 'remind2d',
  remind_1d: 'remind1d',
  escalate_supervisor: 'escalateSupervisor',
}

function Toggle({
  label,
  hint,
  icon,
  on,
  onChange,
  disabled = false,
}: {
  label: string
  hint?: string
  icon?: React.ReactNode
  on: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-3 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        {icon && (
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-canvas text-brand-muted">
            {icon}
          </span>
        )}
        <div>
          <p className="text-sm font-semibold text-brand-blue-dark">{label}</p>
          {hint && <p className="text-xs text-brand-muted-soft">{hint}</p>}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed"
        style={{ background: on ? '#1FA97A' : '#D7DBE8' }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
          style={{ left: on ? '22px' : '2px' }}
        />
      </button>
    </div>
  )
}

export function RemindersTab({ courses }: { courses: ReminderCourse[] }) {
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '')
  const [settings, setSettings] = useState<ReminderSettings>(
    courses[0]?.settings ?? {
      remind_inapp: true, remind_email: true, remind_sms: false,
      remind_2wk: false, remind_1wk: true, remind_2d: false, remind_1d: true,
      escalate_supervisor: true,
    }
  )
  const [saving, setSaving] = useState(false)

  const selectCourse = (id: string) => {
    setCourseId(id)
    const c = courses.find((x) => x.id === id)
    if (c) setSettings(c.settings)
  }

  const update = async (key: keyof ReminderSettings, value: boolean) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    setSaving(true)
    try {
      await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: courseId, [API_KEY[key]]: value }),
      })
    } finally {
      setSaving(false)
    }
  }

  // Preview derivations.
  const channelNames = [
    settings.remind_inapp && 'in-app',
    settings.remind_email && 'email',
    settings.remind_sms && 'SMS',
  ].filter(Boolean) as string[]
  const earliestWindow = settings.remind_2wk
    ? '2 weeks'
    : settings.remind_1wk
      ? '1 week'
      : settings.remind_2d
        ? '2 days'
        : settings.remind_1d
          ? '1 day'
          : null

  if (courses.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
        No courses yet — create one in the Course builder.
      </p>
    )
  }

  return (
    <div className="space-y-5">
      {/* Per-course scope banner */}
      <div className="rounded-2xl border p-5" style={{ borderColor: '#CFE0FB', background: '#EFF3FE' }}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm font-semibold text-brand-blue-bright">Settings for course</label>
          <select
            value={courseId}
            onChange={(e) => selectCourse(e.target.value)}
            className="rounded-lg border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-blue-dark focus:border-brand-blue focus:outline-none"
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          {saving && <span className="text-xs text-brand-muted-soft">Saving…</span>}
        </div>
        <p className="mt-2 text-sm text-brand-muted-soft">Each course carries its own reminder &amp; escalation rules.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-5">
          {/* Delivery channels */}
          <div className="rounded-2xl border border-brand-border bg-white p-5">
            <h3 className="text-base font-bold text-brand-blue-dark">Delivery channels</h3>
            <p className="text-xs text-brand-muted-soft">How reminders reach members. At least one channel is required for mandatory training.</p>
            <div className="mt-2 divide-y divide-brand-hairline">
              <Toggle label="In-app notification" hint="Shows in the bell menu and dashboard" icon={<Bell className="h-4 w-4" />} on={settings.remind_inapp} onChange={(v) => update('remind_inapp', v)} />
              <Toggle label="Email" hint="Sent to the member's email" icon={<Mail className="h-4 w-4" />} on={settings.remind_email} onChange={(v) => update('remind_email', v)} />
              <Toggle label="SMS / text message" hint="Coming soon — SMS delivery is not yet enabled" icon={<MessageSquare className="h-4 w-4" />} on={false} disabled onChange={() => {}} />
            </div>
          </div>

          {/* Reminder schedule */}
          <div className="rounded-2xl border border-brand-border bg-white p-5">
            <h3 className="text-base font-bold text-brand-blue-dark">Reminder schedule</h3>
            <p className="text-xs text-brand-muted-soft">When to remind members before a deadline.</p>
            <div className="mt-2 divide-y divide-brand-hairline">
              <Toggle label="2 weeks before" on={settings.remind_2wk} onChange={(v) => update('remind_2wk', v)} />
              <Toggle label="1 week before" on={settings.remind_1wk} onChange={(v) => update('remind_1wk', v)} />
              <Toggle label="2 days before" on={settings.remind_2d} onChange={(v) => update('remind_2d', v)} />
              <Toggle label="1 day before" on={settings.remind_1d} onChange={(v) => update('remind_1d', v)} />
            </div>
          </div>

          {/* Escalation */}
          <div className="rounded-2xl border border-brand-border bg-white p-5">
            <h3 className="text-base font-bold text-brand-blue-dark">Escalation</h3>
            <Toggle
              label="Notify the supervising adult"
              hint="Alerts the Teacher or Student Manager registered to the group if mandatory training is still incomplete past the deadline."
              on={settings.escalate_supervisor}
              onChange={(v) => update('escalate_supervisor', v)}
            />
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Preview</p>
          <div className="overflow-hidden rounded-2xl border border-brand-border bg-white">
            <div className="bg-gradient-to-br from-[#13183A] to-[#0E1330] px-5 py-4">
              <span className="font-heading text-sm font-bold tracking-wide text-white">STELLR</span>
            </div>
            <div className="space-y-3 p-5">
              <p className="text-xs text-brand-muted-soft">
                Sent via {channelNames.length > 0 ? channelNames.join(' · ') : 'no channel selected'}
              </p>
              <p className="text-lg font-bold text-brand-blue-dark">
                Action needed: 1 of your required trainings is due soon
              </p>
              <p className="text-sm text-brand-muted">
                {earliestWindow
                  ? `You'll get this reminder up to ${earliestWindow} before the deadline. Complete your required training to stay on track.`
                  : 'No reminder schedule is enabled — members will not be reminded before the deadline.'}
              </p>
              <div className="border-t border-brand-hairline pt-3 text-xs text-brand-muted-soft">
                {settings.escalate_supervisor
                  ? 'If still incomplete after the deadline, the supervising adult (Teacher or Student Manager) will be notified.'
                  : 'Escalation is off — supervising adults will not be notified.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
