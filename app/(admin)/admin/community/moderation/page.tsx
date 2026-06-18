import { supabaseServer } from '@/lib/supabase'
import { FlagQueue } from '@/components/admin/community/FlagQueue'

export const metadata = { title: 'Admin — Community Moderation' }

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status = 'pending' } = await searchParams
  const db = supabaseServer()

  const { data: flagsRaw } = await db
    .from('community_flags')
    .select(`
      id, content_type, content_id, reason, status, created_at,
      flagged_by_member:flagged_by(first_name, last_name, email),
      resolved_by_member:resolved_by(first_name, last_name)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })

  // Normalise the aliased join columns from array shape to object shape.
  type FlagRaw = typeof flagsRaw extends (infer T)[] | null ? T : never
  const flags = (flagsRaw ?? []).map((f: FlagRaw) => ({
    ...f,
    flagged_by_member: Array.isArray(f.flagged_by_member) ? f.flagged_by_member[0] ?? null : f.flagged_by_member,
    resolved_by_member: Array.isArray(f.resolved_by_member) ? f.resolved_by_member[0] ?? null : f.resolved_by_member,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Content Moderation</h1>
          <p className="mt-0.5 text-sm text-brand-muted-soft">
            Review flagged posts and comments (FR-COM-07)
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {(['pending', 'resolved', 'dismissed'] as const).map((s) => (
            <a
              key={s}
              href={`?status=${s}`}
              className={[
                'rounded-md px-3 py-1.5 font-medium capitalize',
                status === s
                  ? 'bg-brand-blue-dark text-white'
                  : 'border border-brand-border text-brand-muted hover:bg-brand-canvas',
              ].join(' ')}
            >
              {s}
            </a>
          ))}
        </div>
      </div>

      <FlagQueue flags={flags ?? []} />
    </div>
  )
}
