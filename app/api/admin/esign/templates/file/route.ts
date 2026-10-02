import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { loadTemplateFile } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from '../guard'

// GET /api/admin/esign/templates/file?path=… — a draft upload or a published
// version's PDF, for the field editor to draw. Only paths of those two shapes.

export async function GET(req: NextRequest) {
  if (!(await adminName())) return forbidden()
  try {
    const bytes = await loadTemplateFile(supabaseServer(), req.nextUrl.searchParams.get('path') ?? '')
    return new NextResponse(new Uint8Array(bytes), { headers: { ...noStore, 'Content-Type': 'application/pdf' } })
  } catch (err) {
    return failure(err)
  }
}
