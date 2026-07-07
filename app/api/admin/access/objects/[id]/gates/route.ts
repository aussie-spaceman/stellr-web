import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { resolveAccessObject } from '@/lib/access-objects'
import { accessGatesEnforced } from '@/lib/access-gates'

// /api/admin/access/objects/[id]/gates — the object's gate profile (payment ∧
// DocuSign, the only enforced gates per decision D-F). Gates are DERIVED, not
// stored per object: events gate on the registration flow (payment + envelope),
// workshops gate on their price, everything else is ungated. GET returns the
// profile the Objects-tab gate pills render; per-member gate state comes from
// lib/access-gates.ts via the roster rows.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  let payment = false
  let docusign = false

  if (object.objectType === 'event' || object.objectType === 'campaign') {
    // Competitions run the full registration gate set.
    payment = true
    docusign = true
  } else if (object.containerId) {
    const db = supabaseServer()
    const { data } = await db
      .from('mentoring_cohorts')
      .select('one_off_price_cents, free_for_tier_ids')
      .eq('id', object.containerId)
      .maybeSingle()
    payment = ((data?.one_off_price_cents as number | null) ?? 0) > 0
  }

  return NextResponse.json({
    object,
    gates: { payment, docusign },
    enforced: accessGatesEnforced(),
  })
}
