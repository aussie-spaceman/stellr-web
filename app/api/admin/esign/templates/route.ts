import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { createVersion } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from './guard'

// POST /api/admin/esign/templates — save the field editor's work as the next,
// unapproved version: { key, title, pdfPath, fieldMap }. Runs every template
// check first and answers 422 with the problems if any fail.

export const maxDuration = 60

export async function POST(req: Request) {
  const by = await adminName()
  if (!by) return forbidden()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body.key !== 'string' || typeof body.title !== 'string' || typeof body.pdfPath !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: noStore })
  }
  try {
    const out = await createVersion(supabaseServer(), {
      key: body.key, title: body.title, pdfPath: body.pdfPath, fieldMap: body.fieldMap, createdBy: by,
    })
    return NextResponse.json(out, { headers: noStore })
  } catch (err) {
    return failure(err)
  }
}
