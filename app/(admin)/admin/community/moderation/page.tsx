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

  const { data: flags } = await db
    .from('community_flags')
    .select(`
      id, content_type, content_id, reason, status, created_at,
      flagged_by_member:flagged_by(first_name, last_name, email),
      resolved_by_member:resolved_by(first_name, last_name)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Content Moderation</h1>
          <p className="mt-0.5 text-sm text-gray-500">
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
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 text-gray-600 hover:bg-gray-50',
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
