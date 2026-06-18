'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, FileText } from 'lucide-react'
import { TemplateForm } from './TemplateForm'
import { CampaignForm } from './CampaignForm'
import type { EmailTemplate, EmailCampaign, Tier } from './types'

const STATUS_STYLE: Record<EmailCampaign['status'], string> = {
  draft: 'bg-brand-hairline text-brand-muted',
  scheduled: 'bg-brand-blue/10 text-brand-blue',
  sending: 'bg-amber-100 text-amber-700',
  sent: 'bg-green-100 text-green-700',
  paused: 'bg-orange-100 text-orange-700',
  archived: 'bg-brand-hairline text-brand-muted-soft',
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
      className={`flex items-center gap-2 border-b-2 px-1 pb-2 text-sm font-medium ${tab === id ? 'border-brand-border text-brand-blue-dark' : 'border-transparent text-brand-muted-soft hover:text-brand-muted'}`}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  )

  return (
    <div className="space-y-6">
      <div className="flex gap-6 border-b border-brand-border">
        {tabBtn('campaigns', 'Campaigns', Mail)}
        {tabBtn('templates', 'Templates', FileText)}
      </div>

      {tab === 'campaigns' ? (
        <>
          <CampaignForm templates={templates} tiers={tiers} />

          <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
            <div className="border-b border-brand-hairline bg-brand-canvas px-4 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Campaigns</p>
            </div>
            <ul className="divide-y divide-brand-hairline">
              {campaigns.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-brand-blue-dark">{c.name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-xs capitalize ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                    </div>
                    <p className="text-xs text-brand-muted-soft">
                      {c.templateName} ·{' '}
                      {c.trigger_type === 'scheduled'
                        ? `Scheduled ${c.scheduled_at ? new Date(c.scheduled_at).toLocaleString() : '—'}`
                        : `Event: ${c.event_key}`}
                      {c.sent_at && ` · sent ${new Date(c.sent_at).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    <button onClick={() => testSend(c.id)} disabled={!!busy} className="rounded border border-brand-border px-2 py-1 text-brand-muted hover:bg-brand-canvas">Test</button>
                    {(c.status === 'draft' || c.status === 'paused') && (
                      <button onClick={() => campaignAction(c.id, 'activate')} disabled={!!busy} className="rounded bg-brand-blue-dark px-2 py-1 font-medium text-white hover:bg-brand-blue-dark">Activate</button>
                    )}
                    {c.status === 'scheduled' && (
                      <button onClick={() => campaignAction(c.id, 'pause')} disabled={!!busy} className="rounded border border-brand-border px-2 py-1 text-brand-muted hover:bg-brand-canvas">Pause</button>
                    )}
                    {c.status !== 'sending' && (
                      <button onClick={() => campaignAction(c.id, 'archive')} disabled={!!busy} className="rounded border border-brand-border px-2 py-1 text-brand-muted-soft hover:bg-brand-canvas">Archive</button>
                    )}
                  </div>
                </li>
              ))}
              {campaigns.length === 0 && <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">No campaigns yet.</li>}
            </ul>
          </div>
        </>
      ) : (
        <>
          <TemplateForm />

          <div className="rounded-xl border border-brand-border bg-white overflow-hidden">
            <div className="border-b border-brand-hairline bg-brand-canvas px-4 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Templates</p>
            </div>
            <ul className="divide-y divide-brand-hairline">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <FileText className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-brand-blue-dark">{t.name}</p>
                    <p className="truncate text-xs text-brand-muted-soft">{t.subject} · <code>{t.key}</code></p>
                  </div>
                  <button
                    onClick={() => act(`/api/admin/email/templates/${t.id}`, { method: 'DELETE' }, 'Archive this template?')}
                    disabled={!!busy}
                    className="shrink-0 rounded border border-brand-border px-2 py-1 text-xs text-brand-muted-soft hover:bg-brand-canvas"
                  >
                    Archive
                  </button>
                </li>
              ))}
              {templates.length === 0 && <li className="px-4 py-6 text-center text-sm text-brand-muted-soft">No templates yet.</li>}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
