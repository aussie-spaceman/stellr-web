import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { tiptapToEmailHtml } from '@/lib/email-render'
import { unknownTokens } from '@/lib/email-tokens'
import { tiptapToPlainText } from '@/lib/community'

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `template-${Date.now()}`

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  key: z.string().trim().max(60).optional(),
  subject: z.string().trim().min(1).max(300),
  bodyJson: z.unknown().optional(),
})

// GET /api/admin/email/templates — list active templates.
export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data } = await db
    .from('email_templates')
    .select('id, key, name, subject, body_json, updated_at')
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })

  return NextResponse.json({ templates: data ?? [] })
}

// POST /api/admin/email/templates — create a reusable template.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { name, subject, bodyJson } = parsed.data

  const bad = unknownTokens(subject, tiptapToPlainText(bodyJson))
  if (bad.length) return NextResponse.json({ error: `Unknown merge fields: ${bad.map((t) => `{{${t}}}`).join(', ')}` }, { status: 400 })

  const db = supabaseServer()
  const key = parsed.data.key ? slug(parsed.data.key) : slug(name)
  const { data, error } = await db
    .from('email_templates')
    .insert({ key, name, subject, body_json: bodyJson ?? null })
    .select('id')
    .single()

  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) {
      return NextResponse.json({ error: `A template with key "${key}" already exists.` }, { status: 409 })
    }
    console.error('[email-templates] insert error:', error.message)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }

  // Return a preview so the UI can confirm the body rendered.
  return NextResponse.json({ id: data.id, previewHtml: tiptapToEmailHtml(bodyJson) })
}
