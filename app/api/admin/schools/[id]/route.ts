import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

// Editable school fields — name plus the address block surfaced in the admin
// portal. Any field present in the body is updated; the rest are left as-is.
const ALLOWED = [
  'name', 'address_line1', 'address_line2', 'city', 'state', 'postcode', 'is_active',
] as const

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
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
