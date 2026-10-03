/**
 * survey-definition.ts — load a survey definition JSON into survey_definitions,
 * optionally publish it, and refresh survey_question_catalog.
 *
 *   npm run survey:definition -- lib/survey/definitions/post_event.v1.json
 *   npm run survey:definition -- lib/survey/definitions/post_event.v1.json --publish
 *
 * A draft can be re-loaded as often as wanted. Publishing freezes it (a
 * database trigger refuses any later change): wording changes after that are a
 * new version in a new file. Only a published definition is used for new
 * events' surveys.
 *
 * Targets whatever Supabase project .env.local points at. Production is
 * refused unless --prod is passed as well, so publishing there is a
 * deliberate act (David's, after he signs off the wording).
 */
import { existsSync, readFileSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const PROD_PROJECT_REF = 'hwtzpfrnksksxlwwabqz'

async function main() {
  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const publish = args.includes('--publish')
  const allowProd = args.includes('--prod')
  if (!file) throw new Error('Usage: npm run survey:definition -- <file.json> [--publish] [--prod]')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (url.includes(PROD_PROJECT_REF) && !allowProd) {
    throw new Error('This points at PRODUCTION. Re-run with --prod if that is intended.')
  }

  const { normaliseDefinition, catalogEntries } = await import('../lib/survey/definition')
  const { definitionSha256 } = await import('../lib/survey/definition-hash')
  const { parseShowIf } = await import('../lib/survey/branching')
  const { upsertDefinitionDraft } = await import('../lib/survey/distributions')
  const { supabaseServer } = await import('../lib/supabase')

  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const def = normaliseDefinition(raw) // throws on a malformed definition
  for (const role of ['student', 'mentor', 'adult'] as const) {
    for (const page of def.branches[role]) for (const q of page.questions) if (q.showIf) parseShowIf(q.showIf)
  }
  const sha = definitionSha256(raw)
  const db = supabaseServer()

  const row = await upsertDefinitionDraft(db, raw, sha)
  console.log(`${raw.key} v${raw.version}: ${row.status} (${row.id}), sha256 ${sha.slice(0, 12)}…`)

  if (publish && row.status === 'draft') {
    const { error } = await db
      .from('survey_definitions')
      .update({ status: 'published', published_at: new Date().toISOString(), published_by: process.env.USER ?? 'script' })
      .eq('id', row.id)
    if (error) throw new Error(`Publishing failed: ${error.message}`)
    console.log('Published. This version can no longer be changed.')
  }

  // Catalog: latest wording per key, first/last version seen.
  const entries = catalogEntries(def)
  const { data: existing } = await db.from('survey_question_catalog').select('question_key, first_version, last_version').in('question_key', entries.map((e) => e.question_key))
  const known = new Map((existing ?? []).map((r) => [r.question_key as string, r]))
  const rows = entries.map((e) => {
    const k = known.get(e.question_key)
    const first = Math.min((k?.first_version as number | null) ?? raw.version, raw.version)
    const last = Math.max((k?.last_version as number | null) ?? raw.version, raw.version)
    return { ...e, survey_key: raw.key, first_version: first, last_version: last, source: 'definition', updated_at: new Date().toISOString() }
  })
  const { error: catErr } = await db.from('survey_question_catalog').upsert(rows, { onConflict: 'question_key' })
  if (catErr) throw new Error(`Catalog update failed: ${catErr.message}`)
  console.log(`Catalog: ${rows.length} question keys.`)
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
