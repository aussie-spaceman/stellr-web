import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { loadTemplateById, loadTemplatePdf, TemplateUnavailableError } from '@/lib/esign/native/templates-store'
import { labelSample, renderSample } from '@/lib/esign/native/template-sample'

// GET /api/admin/esign/templates/:id/preview?as=blank|labels
//
// A Stellr signing document version as a PDF, for checking before approval:
// `blank` is the stored template exactly as signers will see it; `labels`
// prints each field's label where the field sits, every signer signed. No real
// person's data is involved.

export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const db = supabaseServer()
  try {
    const template = await loadTemplateById(db, id)
    const blank = await loadTemplatePdf(db, template)
    const bytes = req.nextUrl.searchParams.get('as') === 'labels'
      ? await renderSample(blank, template.map, labelSample)
      : blank
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${template.key}-v${template.version}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    if (err instanceof TemplateUnavailableError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
