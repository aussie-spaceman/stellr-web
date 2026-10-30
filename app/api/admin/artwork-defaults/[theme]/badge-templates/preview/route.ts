import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { generateBadgesPdf } from '@/lib/event-pdf'
import { isArtworkTheme } from '@/lib/artwork-theme'
import { designOf, loadDefaultBadgeTemplate, placementFromParams, placementOf, prepareTemplate } from '@/lib/event-badges'

export const dynamic = 'force-dynamic'

// GET ?id=<template>&name=&name_x=&name_y=&name_max_width=&name_size=
// One label on a theme default, with a sample name, shown inline — the event
// preview (/api/admin/events/[slug]/badge-templates/preview) for the defaults.
export async function GET(req: Request, { params }: { params: Promise<{ theme: string }> }) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { theme } = await params
  if (!isArtworkTheme(theme)) return NextResponse.json({ error: 'Unknown theme' }, { status: 404 })

  const search = new URL(req.url).searchParams
  const name = (search.get('name') ?? '').trim().slice(0, 120) || 'Alexandra Montgomery-Whitfield'
  const db = supabaseServer()
  const template = await loadDefaultBadgeTemplate(db, theme, search.get('id') ?? '')
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
      'Content-Disposition': `inline; filename="${theme}-badge-preview.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
