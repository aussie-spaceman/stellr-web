import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { requireEventAccess } from '@/lib/event-access'
import { generateBadgesPdf } from '@/lib/event-pdf'
import { designOf, loadBadgeTemplate, placementFromParams, placementOf, prepareTemplate } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// GET ?id=<template>&name=&name_x=&name_y=&name_max_width=&name_size=
// One label, with a sample name, shown inline — so an admin can see where the
// name lands (and how a long one shrinks) before printing a stack. Unsaved
// slider values ride along as query params and override the stored ones.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const access = await requireEventAccess(slug)
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })

  const search = new URL(req.url).searchParams
  const name = (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield'
  const db = supabaseServer()
  const template = await loadBadgeTemplate(db, slug, search.get('id') ?? '')
  if (!template) return NextResponse.json({ error: 'Upload the background first.' }, { status: 400 })
  const prepared = await prepareTemplate(db, template)
  if (!prepared) return NextResponse.json({ error: 'The background could not be loaded. Upload it again.' }, { status: 500 })

  const design = designOf(template, prepared, placementFromParams(placementOf(template, prepared), search))
  const [first, ...rest] = name.split(' ')
  const pdf = await generateBadgesPdf(
    [{ person: { firstName: first, lastName: rest.join(' '), subtitle: '' }, design }],
    '',
    template.format,
    { single: true },
  )
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${slug}-badge-preview.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
