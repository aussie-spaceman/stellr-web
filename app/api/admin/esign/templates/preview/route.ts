import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { loadTemplateFile, TemplateAdminError } from '@/lib/esign/native/template-admin'
import { parseFieldMap } from '@/lib/esign/native/template'
import { labelSample, renderSample } from '@/lib/esign/native/template-sample'
import { adminName, failure, forbidden, noStore } from '../guard'

// POST /api/admin/esign/templates/preview — the document with each field's
// label printed where the editor currently has it: { pdfPath, fieldMap }.
// Nothing is saved.

export const maxDuration = 30

export async function POST(req: Request) {
  if (!(await adminName())) return forbidden()
  const body = (await req.json().catch(() => null)) as { pdfPath?: unknown; fieldMap?: unknown } | null
  if (!body || typeof body.pdfPath !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: noStore })
  try {
    let map
    try {
      map = parseFieldMap(body.fieldMap)
    } catch (err) {
      const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues?.map((i) => `${i.path.join('.')}: ${i.message}`)
      throw new TemplateAdminError('The fields are not valid.', issues ?? [])
    }
    const pdf = await renderSample(await loadTemplateFile(supabaseServer(), body.pdfPath), map, labelSample)
    return new NextResponse(new Uint8Array(pdf), { headers: { ...noStore, 'Content-Type': 'application/pdf' } })
  } catch (err) {
    return failure(err)
  }
}
