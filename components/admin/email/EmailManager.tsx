'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, FileText } from 'lucide-react'
import { TemplateForm } from './TemplateForm'
import { CampaignForm } from './CampaignForm'
import type { EmailTemplate, EmailCampaign, Tier } from './types'

const STATUS_STYLE: Record<EmailCampaign['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-100 text-blue-700',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  paused: 'bg-orange-100 text-orange-700',
  archived: 'bg-gray-100 text-gray-400',
}

export function EmailManager({
  templates, campaigns, tiers,
}: { templates: EmailTemplate[]; campaigns: EmailCampaign[]; tiers: Tier[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<'campaigns' | 'templates'>('campaigns')
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (url: string, init: RequestInit, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(url)
    try {
      const res = await fetch(url, init)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        window.alert(json.error ?? 'Action failed.')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  const campaignAction = (id: string, action: 'activate' | 'pause' | 'archive') =>
    act(`/api/admin/email/campaigns/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }, action === 'archive' ? 'Archive this campaign?' : undefined)

  const testSend = async (id: string) => {
    const email = window.prompt('Send a test to which email address?')
    if (!email) return
    await act(`/api/admin/email/campaigns/${id}/test`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
    })
    window.alert('Test sent (check the inbox).')
  }

  const tabBtn = (id: 'campaigns' | 'templates', label: string, Icon: typeof Mail) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-medium ${tab === id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-gray-200">
        {tabBtn('campaigns', 'Campaigns', Mail)}
        {tabBtn('templates', 'Templates', FileText)}
      </div>

      {tab === 'campaigns' ? (
        <>
          <CampaignForm templates={templates} tiers={tiers} />

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Campaigns</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {campaigns.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-gray-900">{c.name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                    </div>
                    <p className="text-xs text-gray-400">
                      {c.templateName} ·{' '}
                      {c.trigger_type === 'scheduled'
                        ? `Scheduled ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : '—'}`
                        : `Event: ${c.event_key}`}
                      {c.sent_at && ` · sent ${new Date(c.sent_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <button onClick={() => testSend(c.id)} disabled={!!busy} className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50">Test</button>
                    {(c.status === 'draft' || c.status === 'paused') && (
                      <button onClick={() => campaignAction(c.id, 'activate')} disabled={!!busy} className="rounded bg-gray-900 px-2 py-1 font-medium text-white hover:bg-gray-800">Activate</button>
                    )}
                    {c.status === 'scheduled' && (
                      <button onClick={() => campaignAction(c.id, 'pause')} disabled={!!busy} className="rounded border border-gray-300 px-2 py-1 text-gray-600 hover:bg-gray-50">Pause</button>
                    )}
                    {c.status !== 'sending' && (
                      <button onClick={() => campaignAction(c.id, 'archive')} disabled={!!busy} className="rounded border border-gray-300 px-2 py-1 text-gray-400 hover:bg-gray-50">Archive</button>
                    )}
                  </div>
                </li>
              ))}
              {campaigns.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No campaigns yet.</li>}
            </ul>
          </div>
        </>
      ) : (
        <>
          <TemplateForm />

          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Templates</p>
            </div>
            <ul className="divide-y divide-gray-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-gray-300" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{t.name}</p>
                    <p className="truncate text-xs text-gray-400">{t.subject} · <code>{t.key}</code></p>
                  </div>
                  <button
                    onClick={() => act(`/api/admin/email/templates/${t.id}`, { method: 'DELETE' }, 'Archive this template?')}
                    disabled={!!busy}
                    className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-400 hover:bg-gray-50"
                  >
                    Archive
                  </button>
                </li>
              ))}
              {templates.length === 0 && <li className="px-4 py-6 text-center text-sm text-gray-400">No templates yet.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
