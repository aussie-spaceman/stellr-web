import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { GitBranch, Info } from 'lucide-react'
import { Badge } from '@stellr/web-ui'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { normaliseDefinition, ROLES, type Question, type RespondentRole, type SurveyDefinition } from '@/lib/survey/definition'
import { fillTemplate } from '@/lib/survey/branching'
import { answerFormat, branchCounts, describeShowIf, pageTitle, skipNote, TYPE_LABELS } from '@/lib/survey/describe'
import { formatDateShort } from '@/lib/utils'

// /admin/surveys/questions — the questions each survey version asks, per
// respondent path, read-only. Published versions are frozen (the database
// refuses edits), so this is exactly what respondents on that version saw.
// A form builder will later create new draft versions from here.
export const metadata = { title: 'Admin — Survey questions' }
export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<RespondentRole, string> = { student: 'Students', mentor: 'Mentors', adult: 'Teachers and parents' }
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', published: 'Published', archived: 'Archived' }
const SAMPLE = { event_title: '[event name]', first_name: '[first name]' }

interface DefinitionRow {
  id: string
  key: string
  version: number
  title: string
  status: string
  published_at: string | null
  definition: unknown
}

export default async function SurveyQuestionsPage({ searchParams }: { searchParams: Promise<{ id?: string; role?: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) redirect('/admin')
  const sp = await searchParams
  const role: RespondentRole = (ROLES as readonly string[]).includes(sp.role ?? '') ? (sp.role as RespondentRole) : 'student'

  const db = supabaseServer()
  const [{ data: defs }, { data: dists }] = await Promise.all([
    db.from('survey_definitions').select('id, key, version, title, status, published_at, definition').order('key').order('version', { ascending: false }),
    db.from('survey_distributions').select('definition_id'),
  ])
  const rows = (defs ?? []) as DefinitionRow[]
  const usedBy = new Map<string, number>()
  for (const d of dists ?? []) usedBy.set(d.definition_id as string, (usedBy.get(d.definition_id as string) ?? 0) + 1)

  const selected = rows.find((r) => r.id === sp.id) ?? rows.find((r) => r.status === 'published') ?? rows[0] ?? null
  let def: SurveyDefinition | null = null
  let defError: string | null = null
  if (selected) {
    try {
      def = normaliseDefinition(selected.definition)
    } catch (err) {
      defError = err instanceof Error ? err.message : String(err)
    }
  }
  const href = (o: { id?: string; role?: string }) => `/admin/surveys/questions?${new URLSearchParams({ id: o.id ?? selected?.id ?? '', role: o.role ?? role })}`

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/surveys" className="text-sm text-primary hover:underline">← Surveys</Link>
        <h1 className="mt-2 font-heading uppercase text-title text-brand-blue-dark">Survey questions</h1>
        <p className="mt-0.5 max-w-content text-sm text-brand-muted-soft">
          What each survey version asks, for each kind of respondent. Read-only. A published version never changes: new wording is published as a new version, and a survey that is already open keeps the version it started with.
        </p>
      </div>

      {/* Versions */}
      <section className="space-y-2" aria-labelledby="versions-heading">
        <h2 id="versions-heading" className="text-sm font-semibold uppercase tracking-wide text-brand-muted">Versions</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-brand-muted-soft">No survey definitions yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {rows.map((r) => {
              const active = r.id === selected?.id
              const n = usedBy.get(r.id) ?? 0
              return (
                <li key={r.id}>
                  <Link
                    href={href({ id: r.id })}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-xl border px-3 py-2 text-sm ${active ? 'border-primary bg-primary-soft' : 'border-brand-border bg-white hover:border-primary'}`}
                  >
                    <span className="font-semibold text-ink">
                      {r.title} · v{r.version}
                    </span>
                    <span className="block text-xs text-brand-muted-soft">
                      {STATUS_LABEL[r.status] ?? r.status}
                      {r.published_at ? ` ${formatDateShort(r.published_at)}` : ''} · {n === 1 ? '1 event' : `${n} events`}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {defError && <p role="alert" className="text-sm text-danger">This version can’t be read: {defError}</p>}

      {def && selected && (
        <>
          {/* Respondent paths */}
          <nav aria-label="Respondent path" className="flex flex-wrap items-end gap-1 border-b border-line">
            {ROLES.map((r) => {
              const c = branchCounts(def, r)
              const active = r === role
              return (
                <Link
                  key={r}
                  href={href({ role: r })}
                  aria-current={active ? 'page' : undefined}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-primary font-semibold text-primary' : 'border-transparent text-brand-muted hover:text-ink'}`}
                >
                  {ROLE_LABEL[r]} <span className="text-xs text-brand-muted-soft">({c.questions})</span>
                </Link>
              )
            })}
            <Link href={`/admin/surveys/questions/preview?${new URLSearchParams({ id: selected.id, role })}`} className="mb-1 ml-auto rounded-lg border border-brand-border bg-white px-3 py-1.5 text-sm text-brand-muted hover:border-primary">
              Preview as a respondent →
            </Link>
          </nav>

          <BranchSummary def={def} role={role} />

          {/* Intro */}
          <section className="rounded-xl border border-brand-border bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Intro screen</p>
            <p className="mt-1 font-semibold text-ink">{fillTemplate(def.intro.heading, SAMPLE)}</p>
            <p className="mt-1 text-sm text-content-body">{role === 'student' ? def.intro.bodyStudent : def.intro.bodyAdult}</p>
          </section>

          <QuestionList def={def} role={role} />
        </>
      )}
    </div>
  )
}

function BranchSummary({ def, role }: { def: SurveyDefinition; role: RespondentRole }) {
  const c = branchCounts(def, role)
  return (
    <p className="text-sm text-brand-muted">
      {c.pages} pages · {c.questions} questions, {c.required} required · {c.conditional} shown only to some people · about {def.targetMinutes[role]} minutes
    </p>
  )
}

function QuestionList({ def, role }: { def: SurveyDefinition; role: RespondentRole }) {
  let n = 0
  return (
    <div className="space-y-6">
      {def.branches[role].map((page, i) => (
        <section key={page.id} aria-labelledby={`page-${page.id}`} className="space-y-3">
          <h2 id={`page-${page.id}`} className="text-sm font-semibold uppercase tracking-wide text-brand-muted">
            Page {i + 1}: {pageTitle(page.id)}
          </h2>
          <ol className="space-y-3">
            {page.questions.map((q) => {
              n++
              return <QuestionCard key={q.key} n={n} q={q} def={def} />
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

function QuestionCard({ n, q, def }: { n: number; q: Question; def: SurveyDefinition }) {
  const format = answerFormat(q)
  const skip = skipNote(q)
  return (
    <li className="rounded-xl border border-brand-border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold text-ink">
          <span className="mr-2 text-brand-muted-soft">{n}.</span>
          {fillTemplate(q.label, SAMPLE)}
        </p>
        <code className="text-xs text-brand-muted-soft">{q.key}</code>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge className="bg-brand-hairline text-brand-muted">{TYPE_LABELS[q.type] ?? q.type}</Badge>
        {q.required ? <Badge>Required</Badge> : <Badge className="bg-brand-hairline text-brand-muted">Optional</Badge>}
        {q.quotable && <Badge className="bg-pathway-amber-bg text-brand-gold-ink">{q.labelTag ?? 'may be quoted'}</Badge>}
      </div>
      {q.help && <p className="mt-2 text-sm text-brand-muted">{q.help}</p>}
      {q.showIf && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-primary">
          <GitBranch size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {describeShowIf(q.showIf, def)}
        </p>
      )}
      {skip && (
        <p className="mt-2 flex items-start gap-1.5 text-sm text-brand-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {skip}
        </p>
      )}
      {q.rows?.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">Rows</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-content-body">
            {q.rows.map((r) => (
              <li key={r.key}>{r.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.options?.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-muted-soft">{q.rows?.length ? 'Scale' : 'Options'}</p>
          <ul className="mt-1 space-y-0.5 text-sm text-content-body">
            {q.options.map((o) => (
              <li key={o.key} className="flex gap-2">
                <span aria-hidden="true" className="text-brand-muted-soft">{q.type === 'multi' ? '☐' : '○'}</span>
                <span>
                  {o.label}
                  {o.exclusive && <span className="text-brand-muted-soft"> (clears the others)</span>}
                  {o.numeric !== null && <span className="text-brand-muted-soft"> · scores {o.numeric}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {format && <p className="mt-2 text-sm text-brand-muted">{format}</p>}
    </li>
  )
}
