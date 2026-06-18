'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Plus, Loader2 } from 'lucide-react'

interface Cohort {
  id: string
  name: string
  channelId?: string
}

interface ChatMessage {
  id: string
  body: string
  author_member_id: string | null
  created_at: string
}

export function AdminOversight({ cohorts }: { cohorts: Cohort[] }) {
  return (
    <div className="space-y-8">
      <CohortChatViewer cohorts={cohorts} />
      <DirectSessionCreate />
    </div>
  )
}

function CohortChatViewer({ cohorts }: { cohorts: Cohort[] }) {
  const [selectedCohort, setSelectedCohort] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)

  const loadChat = async (cohortId: string) => {
    setSelectedCohort(cohortId)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/community/chat?channelId=cohort:${cohortId}`)
      if (res.ok) {
        const json = await res.json()
        setMessages(json.messages ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <MessageSquare className="h-4 w-4" /> Cohort chats (read-only)
      </h3>
      <select
        value={selectedCohort}
        onChange={(e) => e.target.value && loadChat(e.target.value)}
        className="mb-3 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
      >
        <option value="">Select a cohort…</option>
        {cohorts.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      {!loading && selectedCohort && (
        <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-3">
          {messages.length === 0 ? (
            <p className="text-sm text-gray-400">No messages.</p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="text-sm">
                <span className="text-xs text-gray-400">{new Date(m.created_at).toLocaleString()}</span>
                <span className="ml-2 text-gray-700">{m.body}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function DirectSessionCreate() {
  const router = useRouter()
  const [hostEmail, setHostEmail] = useState('')
  const [cohortId, setCohortId] = useState('')
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const create = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/community/cohorts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scheduleSession', hostEmail, cohortId, start }),
      })
      const json = await res.json()
      if (res.ok) {
        setResult('Session created.')
        router.refresh()
      } else {
        setResult(json.error ?? 'Failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
        <Plus className="h-4 w-4" /> Create session directly
      </h3>
      <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
        <input
          type="email"
          value={hostEmail}
          onChange={(e) => setHostEmail(e.target.value)}
          placeholder="Host email"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          type="text"
          value={cohortId}
          onChange={(e) => setCohortId(e.target.value)}
          placeholder="Cohort ID"
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={create}
          disabled={busy || !hostEmail || !start}
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Create
        </button>
        {result && <p className="text-sm text-gray-600">{result}</p>}
      </div>
    </div>
  )
}
