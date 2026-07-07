import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'

// The object→object relationship matrix (object_type_relations, migration 125).
// GET returns all 49 cells; PATCH flips one. Read by the Rules-tab matrix editor
// and by every attach endpoint (via lib/access-objects attachAllowed).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data, error } = await db
    .from('object_type_relations')
    .select('from_type, to_type, allowed')
    .order('from_type')
    .order('to_type')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ relations: data ?? [] })
}

const OBJECT_TYPES = ['space', 'course', 'workshop', 'cohort', 'event', 'campaign', 'resource'] as const

const patchSchema = z.object({
  fromType: z.enum(OBJECT_TYPES),
  toType: z.enum(OBJECT_TYPES),
  allowed: z.boolean(),
})

export async function PATCH(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { fromType, toType, allowed } = parsed.data
  const db = supabaseServer()
  const { error } = await db
    .from('object_type_relations')
    .upsert(
      { from_type: fromType, to_type: toType, allowed, updated_at: new Date().toISOString() },
      { onConflict: 'from_type,to_type' },
    )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
