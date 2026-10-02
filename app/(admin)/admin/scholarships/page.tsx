import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { SCHOLARSHIP_COLUMNS, withStages, type ScholarshipApplication, type ScholarshipStage } from '@/lib/scholarships'
import { ScholarshipStagePill } from '@/components/admin/ScholarshipStagePill'

export const metadata = { title: 'Admin — Scholarships' }
export const dynamic = 'force-dynamic'

type Filter = 'review' | 'offered' | 'all'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'review', label: 'To review' },
  { key: 'offered', label: 'Offered' },
  { key: 'all', label: 'All' },
]
const OFFERED: ScholarshipStage[] = ['awaiting_details', 'awaiting_payment', 'confirmed', 'attended']

export default async function AdminScholarshipsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')

  const { show } = await searchParams
  const filter: Filter = show === 'offered' || show === 'all' ? show : 'review'

  const db = supabaseServer()
  const { data } = await db
    .from('scholarship_applications')
    .select(SCHOLARSHIP_COLUMNS)
    .order('created_at', { ascending: false })
  const apps = await withStages(db, (data ?? []) as ScholarshipApplication[])

  const toReview = apps.filter((a) => a.stage === 'submitted').length
  const offered = apps.filter((a) => OFFERED.includes(a.stage)).length
  const accepted = apps.filter((a) => a.stage === 'confirmed' || a.stage === 'attended').length
  const rows =
    filter === 'review' ? apps.filter((a) => a.stage === 'submitted')
    : filter === 'offered' ? apps.filter((a) => OFFERED.includes(a.stage))
    : apps

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Scholarships</h1>
          <p className="text-sm text-brand-muted-soft mt-0.5">
            Applications from /scholarship. Offering one registers the student and sends their emails.
          </p>
        </div>
        <div className="flex gap-5 text-sm text-right">
          <div>
            <p className="text-2xl font-bold text-pathway-amber-deep">{toReview}</p>
            <p className="text-xs text-brand-muted-soft">To review</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-primary">{offered}</p>
            <p className="text-xs text-brand-muted-soft">Offered</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-enviro-green">{accepted}</p>
            <p className="text-xs text-brand-muted-soft">Accepted</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'review' ? '/admin/scholarships' : `/admin/scholarships?show=${f.key}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              filter === f.key ? 'bg-ink text-white' : 'bg-white border border-line text-content-body hover:border-primary'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-ds-card border border-line bg-white">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-content-body">
            <tr>
              <th className="px-4 py-3">Applicant</th>
              <th className="px-4 py-3">Event</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-light">
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-content-body">
                  {filter === 'review' ? 'Nothing waiting for review.' : 'No applications here yet.'}
                </td>
              </tr>
            )}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-surface">
                <td className="px-4 py-3">
                  <Link href={`/admin/scholarships/${a.id}`} className="font-semibold text-ink hover:text-primary">
                    {a.first_name} {a.last_name}
                  </Link>
                  <div className="text-xs text-content-body">{a.email}</div>
                </td>
                <td className="px-4 py-3 text-content-body">{a.event_title ?? a.activity ?? '—'}</td>
                <td className="px-4 py-3 text-content-body whitespace-nowrap">
                  {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td className="px-4 py-3">
                  <ScholarshipStagePill stage={a.stage} percent={a.percent_off} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
