import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { notFound, redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { normaliseDefinition, ROLES, type RespondentRole } from '@/lib/survey/definition'
import { runtimeOptions } from '@/lib/survey/access'
import { SurveyPreview } from '@/components/admin/surveys/SurveyPreview'

// /admin/surveys/questions/preview — click through a survey version as a
// respondent would, with nothing saved. Admins only.
export const metadata = { title: 'Admin — Survey preview' }
export const dynamic = 'force-dynamic'

export default async function SurveyPreviewPage({ searchParams }: { searchParams: Promise<{ id?: string; role?: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')
  const sp = await searchParams
  if (!sp.id || !/^[0-9a-f-]{36}$/.test(sp.id)) notFound()
  const role: RespondentRole = (ROLES as readonly string[]).includes(sp.role ?? '') ? (sp.role as RespondentRole) : 'student'

  const db = supabaseServer()
  const { data: row } = await db.from('survey_definitions').select('id, version, title, definition').eq('id', sp.id).maybeSingle()
  if (!row) notFound()
  const definition = normaliseDefinition(row.definition)
  const options = await runtimeOptions(db)

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/admin/surveys/questions?${new URLSearchParams({ id: row.id as string, role })}`} className="text-sm text-primary hover:underline">
          ← {row.title as string} v{row.version as number} questions
        </Link>
        <h1 className="mt-2 font-heading uppercase text-title text-brand-blue-dark">Survey preview</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">Choose who you’re previewing as. Questions that depend on these facts appear or disappear to match.</p>
      </div>
      <SurveyPreview definition={definition} runtimeOptions={options} initialRole={role} />
    </div>
  )
}
