import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/admin/access/conflicts — the redundancy audit for the Rules-tab
// Conflicts panel: members who are both on-roster and a manager of the same
// object (access_redundancy_audit view, migration 125).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('access_redundancy_audit')
    .select('member_id, object_type, object_id, roster_role, manager_role, manager_source')
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = data ?? []
  const memberIds = [...new Set(rows.map((r) => r.member_id as string))]
  const names = new Map<string, string>()
  if (memberIds.length) {
    const { data: members } = await db.from('members').select('id, first_name, last_name').in('id', memberIds)
    for (const m of members ?? []) {
      names.set(m.id as string, `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim())
    }
  }
  return NextResponse.json({
    conflicts: rows.map((r) => ({ ...r, memberName: names.get(r.member_id as string) ?? r.member_id })),
  })
}
