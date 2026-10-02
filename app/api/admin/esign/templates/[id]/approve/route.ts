import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { approveVersion } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from '../../guard'

// POST /api/admin/esign/templates/:id/approve — { confirm: "<key> v<n>" }.
// Re-runs the checks, records who approved it, and puts it in use.

export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const by = await adminName()
  if (!by) return forbidden()
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore })
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null
  try {
    const out = await approveVersion(supabaseServer(), id, { by, confirm: typeof body?.confirm === 'string' ? body.confirm : '' })
    console.info(`[esign-templates] ${out.key} v${out.version} approved by ${by}`)
    return NextResponse.json(out, { headers: noStore })
  } catch (err) {
    return failure(err)
  }
}
