import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { acceptUpload, MAX_UPLOAD_BYTES } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from '../guard'

// POST /api/admin/esign/templates/upload — a new agreement PDF for the field
// editor (multipart, field "file"). Checked by its bytes and rebuilt clean;
// the answer names the cleaned draft the editor works on.

export const maxDuration = 60

export async function POST(req: Request) {
  if (!(await adminName())) return forbidden()
  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64_000) {
    return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 413, headers: noStore })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a PDF to upload.' }, { status: 400, headers: noStore })
  try {
    const out = await acceptUpload(supabaseServer(), new Uint8Array(await file.arrayBuffer()))
    return NextResponse.json(out, { headers: noStore })
  } catch (err) {
    return failure(err)
  }
}
