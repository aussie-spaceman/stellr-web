'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeftRight, Search } from 'lucide-react'
import { Badge, Button, Choice, Dialog, Field, Input, Select } from '@stellr/web-ui'
import { MERGE_FIELDS, type FieldChoice, type MergeMember, type MergeProposal } from '@/lib/member-merge'
import { isLikelySchoolEmail } from '@/lib/member-email'

// Admin "Merge members" (4 Nov 2026): pick the duplicate, review every field,
// then fold it into one record. The other record is permanently deleted.
// Server: /api/admin/members/merge (admins only; the write is one transaction).

interface SearchHit { id: string; first_name: string; last_name: string; email: string; membership_id: string | null }
interface Link { label: string; count: number }
interface Preview {
  keep: MergeMember
  drop: MergeMember
  proposal: MergeProposal
  links: { keep: Link[]; drop: Link[] }
}

const REASON: Record<FieldChoice['reason'], string> = {
  same: 'Same on both',
  only_keep: 'Only on kept record',
  only_drop: 'Only on removed record',
  newer: 'Newer record',
  email_sort: 'Sorted by domain',
  login: 'Kept login',
}

function show(v: unknown): string {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v).replace(/_/g, ' ')
}

function recordName(m: MergeMember): string {
  return `${show(m.first_name)} ${show(m.last_name)}`
}

export function MemberMergeDialog({
  member,
  className,
}: {
  member: { id: string; first_name: string; last_name: string }
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(member.last_name)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [otherId, setOtherId] = useState<string | null>(null)
  const [keepId, setKeepId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [choice, setChoice] = useState<Record<string, unknown>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setQuery(member.last_name)
    setHits([])
    setOtherId(null)
    setKeepId(null)
    setPreview(null)
    setChoice({})
    setConfirmed(false)
    setError(null)
  }

  // Search as the admin types (the existing admin member picker).
  useEffect(() => {
    if (!open || otherId) return
    const q = query.trim()
    if (q.length < 2) { setHits([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(q)}`)
      const data = await res.json().catch(() => null)
      setSearching(false)
      setHits(((data?.members ?? []) as SearchHit[]).filter((m) => m.id !== member.id))
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, otherId, member.id])

  // Load the review whenever the pair or the survivor changes.
  useEffect(() => {
    if (!otherId) return
    let cancelled = false
    ;(async () => {
      setError(null)
      setPreview(null)
      const params = new URLSearchParams({ a: member.id, b: otherId })
      if (keepId) params.set('keep', keepId)
      const res = await fetch(`/api/admin/members/merge?${params}`)
      const data = await res.json().catch(() => null)
      if (cancelled) return
      if (!res.ok) { setError(data?.error ?? 'Could not load these members.'); return }
      const p = data as Preview
      setPreview(p)
      setKeepId(p.keep.id)
      setChoice(Object.fromEntries(Object.entries(p.proposal.fields).map(([c, f]) => [c, f.value])))
      setConfirmed(false)
    })()
    return () => { cancelled = true }
  }, [otherId, keepId, member.id])

  // Every address on either record, for the two email rows.
  const addresses = useMemo(() => {
    if (!preview) return [] as string[]
    const all = [preview.keep.email, preview.drop.email, preview.keep.school_email, preview.drop.school_email]
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim().toLowerCase())
    return [...new Set(all)]
  }, [preview])

  async function commit() {
    if (!preview) return
    setBusy(true)
    setError(null)
    const fields = { ...choice }
    delete fields.clerk_user_id
    const res = await fetch('/api/admin/members/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keepId: preview.keep.id, dropId: preview.drop.id, fields }),
    })
    const data = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setError(data?.error ?? 'The merge did not complete.'); return }
    setOpen(false)
    if (data?.keptMemberId && data.keptMemberId !== member.id) router.push(`/admin/members/${data.keptMemberId}`)
    else router.refresh()
  }

  const keep = preview?.keep
  const drop = preview?.drop
  const sameEmails = typeof choice.school_email === 'string' && choice.school_email !== '' && choice.school_email === choice.email

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        title="Combine this member with a duplicate record"
        className={className}
      >
        Merge duplicate
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        size="3xl"
        title="Merge duplicate members"
        description={preview
          ? 'Check each field. The kept record takes the values you select; the other record is then permanently deleted.'
          : 'Find the duplicate record for this member.'}
        footer={preview ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="secondary" type="button" onClick={() => { setOtherId(null); setKeepId(null); setPreview(null) }} disabled={busy}>
              Back
            </Button>
            <Button type="button" onClick={commit} disabled={!confirmed || busy || sameEmails}>
              {busy ? 'Merging…' : 'Merge records'}
            </Button>
          </div>
        ) : undefined}
      >
        {error && <p role="alert" className="mb-4 rounded-ds-card border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">{error}</p>}

        {!otherId && (
          <div className="space-y-3">
            <Field label="Search members" hint="Name or email. The member you started from is left out.">
              <Input type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            </Field>
            {searching && <p className="text-sm text-content-muted">Searching…</p>}
            <ul className="divide-y divide-line rounded-ds-card border border-line">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => setOtherId(h.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-content-body">{h.first_name} {h.last_name}</span>
                      <span className="block truncate text-xs text-content-muted">{h.email}</span>
                    </span>
                    <span className="shrink-0 text-xs text-content-muted">{h.membership_id ?? ''}</span>
                  </button>
                </li>
              ))}
              {!searching && hits.length === 0 && query.trim().length >= 2 && (
                <li className="px-4 py-3 text-sm text-content-muted">No other members match.</li>
              )}
            </ul>
            {!searching && hits.length === 0 && query.trim().length < 2 && (
              <p className="flex items-center gap-2 text-sm text-content-muted"><Search size={16} aria-hidden /> Type at least two letters.</p>
            )}
          </div>
        )}

        {otherId && !preview && !error && <p className="text-sm text-content-muted">Loading both records…</p>}

        {preview && keep && drop && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
              <RecordCard tone="keep" m={keep} links={preview.links.keep} />
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setKeepId(drop.id)}
                  className="inline-flex items-center gap-2 rounded-control border border-line-strong px-3 py-2 text-sm text-content-body hover:bg-surface"
                  title="Keep the other record instead"
                >
                  <ArrowLeftRight size={16} aria-hidden /> Swap
                </button>
              </div>
              <RecordCard tone="drop" m={drop} links={preview.links.drop} />
            </div>

            <div className="overflow-x-auto rounded-ds-card border border-line">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-surface text-left text-xs text-content-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Field</th>
                    <th className="px-3 py-2 font-medium">Kept record</th>
                    <th className="px-3 py-2 font-medium">Removed record</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {MERGE_FIELDS.map((f, i) => {
                    const prev = MERGE_FIELDS[i - 1]
                    const proposed = preview.proposal.fields[f.column]
                    const k = keep[f.column]
                    const d = drop[f.column]
                    const isEmail = f.column === 'email' || f.column === 'school_email'
                    const bothBlank = !isEmail && show(k) === '—' && show(d) === '—'
                    if (bothBlank) return null
                    const name = `merge-${f.column}`
                    return [
                      (!prev || prev.group !== f.group) && (
                        <tr key={`${f.group}-h`} className="bg-surface/60">
                          <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-content-secondary">{f.group}</td>
                        </tr>
                      ),
                      <tr key={f.column} className="align-top">
                        <th scope="row" className="px-3 py-2 text-left font-medium text-content-body">{f.label}</th>
                        {isEmail ? (
                          <>
                            <td className="px-3 py-2 text-content-secondary break-all">{show(k)}</td>
                            <td className="px-3 py-2 text-content-secondary break-all">{show(d)}</td>
                            <td className="px-3 py-2">
                              <Select
                                aria-label={f.label}
                                value={String(choice[f.column] ?? '')}
                                onChange={(e) => setChoice((c) => ({ ...c, [f.column]: e.target.value || null }))}
                              >
                                {f.column === 'school_email' && <option value="">None</option>}
                                {addresses.map((a) => (
                                  <option key={a} value={a}>{a}{isLikelySchoolEmail(a) ? ' (school)' : ''}</option>
                                ))}
                              </Select>
                            </td>
                          </>
                        ) : f.locked ? (
                          <>
                            <td className="px-3 py-2 text-content-secondary">{k ? 'Has a login' : '—'}</td>
                            <td className="px-3 py-2 text-content-secondary">{d ? 'Has a login' : '—'}</td>
                            <td className="px-3 py-2 text-xs text-content-muted">
                              {k ? 'Kept record keeps its login' : d ? 'Login moves to the kept record' : 'No login'}
                              {k && d ? '. The other login is deleted.' : ''}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2">
                              <Choice type="radio" name={name} label={<span className="break-all">{show(k)}</span>}
                                checked={show(choice[f.column]) === show(k)}
                                onChange={() => setChoice((c) => ({ ...c, [f.column]: k ?? null }))} />
                            </td>
                            <td className="px-3 py-2">
                              <Choice type="radio" name={name} label={<span className="break-all">{show(d)}</span>}
                                checked={show(choice[f.column]) === show(d) && show(k) !== show(d)}
                                disabled={show(k) === show(d)}
                                onChange={() => setChoice((c) => ({ ...c, [f.column]: d ?? null }))} />
                            </td>
                            <td className="px-3 py-2 text-xs text-content-muted">{proposed ? REASON[proposed.reason] : ''}</td>
                          </>
                        )}
                      </tr>,
                    ]
                  })}
                </tbody>
              </table>
            </div>
            {sameEmails && <p className="text-sm text-danger">Personal and school email can&apos;t be the same address.</p>}

            <div className="rounded-ds-card border border-danger/30 bg-danger/5 p-4">
              <Choice
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                label={<>
                  Permanently delete record <strong>{drop.membership_id ?? drop.id}</strong> ({recordName(drop)}). Everything linked to it moves
                  to <strong>{keep.membership_id ?? keep.id}</strong>. This can&apos;t be undone.
                </>}
              />
            </div>
          </div>
        )}
      </Dialog>
    </>
  )
}

function RecordCard({ tone, m, links }: { tone: 'keep' | 'drop'; m: MergeMember; links: Link[] }) {
  return (
    <div className={tone === 'keep' ? 'rounded-ds-card border-2 border-primary p-4' : 'rounded-ds-card border border-line p-4'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Badge>{tone === 'keep' ? 'Kept' : 'Removed'}</Badge>
        <span className="text-xs text-content-muted">Member ID {m.membership_id ?? '—'}</span>
      </div>
      <p className="font-medium text-content-body">{recordName(m)}</p>
      <p className="text-xs text-content-muted">
        Created {new Date(m.created_at).toLocaleDateString()} · Updated {new Date(m.updated_at).toLocaleDateString()}
      </p>
      <ul className="mt-2 space-y-0.5 text-xs text-content-secondary">
        {links.length === 0 && <li>Nothing linked</li>}
        {links.map((l) => <li key={l.label}>{l.label}: {l.count}</li>)}
      </ul>
    </div>
  )
}
