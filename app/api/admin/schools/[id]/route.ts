import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { hasCapability } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// Editable school fields — name plus the address block surfaced in the admin
// portal. Any field present in the body is updated; the rest are left as-is.
const ALLOWED = [
  'name', 'address_line1', 'address_line2', 'city', 'state', 'postcode', 'is_active',
] as const

// What this request acted on, which withAudit's spec cannot read for itself.
const audited = new WeakMap<Request, { id: string; userId: string | null }>()

export const PATCH = withAudit(
  ({ args: [req] }: { args: [Request, { params: Promise<{ id: string }> }] }) => {
    const a = audited.get(req)
    return {
      action: 'school.record.update',
      actor: a ? { userId: a.userId } : { session: true },
      tenant: { stellr: true },
      target: { table: 'schools', id: a?.id ?? null },
    }
  },
  updateSchool,
)

async function updateSchool(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!(await hasCapability('schools:write'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  audited.set(req, { id, userId })
  const body = await req.json().catch(() => ({}))

  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED) {
    if (key in body) {
      // Normalise empty strings to null for the nullable address columns.
      updates[key] = key === 'is_active' || key === 'name'
        ? body[key]
        : (typeof body[key] === 'string' && body[key].trim() === '' ? null : body[key])
    }
  }

  if (!('name' in updates) && Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }
  if ('name' in updates && (typeof updates.name !== 'string' || !updates.name.trim())) {
    return NextResponse.json({ error: 'School name is required' }, { status: 400 })
  }
  if (typeof updates.name === 'string') updates.name = updates.name.trim()

  const db = supabaseServer()
  const { data, error } = await db
    .from('schools')
    .update(updates)
    .eq('id', id)
    .select('id, name, city, state, postcode, address_line1, address_line2, is_active')
    .single()

  if (error) {
    console.error('Admin school update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ school: data })
}
