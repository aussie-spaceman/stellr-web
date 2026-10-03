/**
 * survey-import-legacy.ts — import a Google Forms post-event survey sheet as
 * legacy survey responses (handover §9; mapping: docs/survey/legacy-mapping.md,
 * lib/survey/legacy-mapping.ts).
 *
 *   npm run survey:import-legacy -- --sheet 2024                     # dry run, reads the Google Sheet
 *   npm run survey:import-legacy -- --sheet 2024 --tab "South West"  # another tab, same questions
 *   npm run survey:import-legacy -- --sheet 2026 --file export.csv   # dry run from a CSV export of the tab
 *   npm run survey:import-legacy -- --sheet 2024 --apply             # write (after David approves the mapping)
 *
 * Default is a DRY RUN: it reads the sheet, maps every row and prints counts
 * and the keys it would write. Free-text answers are never printed. The dry
 * run also counts rows already imported, read-only, unless --offline.
 *
 * --apply, per sheet:
 *   1. creates the published placeholder definition (legacy_2024 / legacy_2026,
 *      v1) if missing; refuses if one exists with a different mapping hash;
 *   2. upserts the legacy_* keys into survey_question_catalog;
 *   3. inserts one survey_responses row per sheet row (source legacy_import,
 *      no participant/member), skipping legacy_refs already present, then its
 *      answers, then sets submitted_at — so a failed row leaves no half-written
 *      submitted response (it is deleted before it is submitted).
 *
 * --file takes a CSV export of exactly one tab (row numbers must match the
 * sheet's, so keep blank rows). XLSX is not read: export the tab as CSV, or
 * omit --file to read the sheet directly with the Google service account.
 *
 * Targets whatever Supabase project .env.local points at. Production is
 * refused unless --prod is passed as well.
 */
import { existsSync, readFileSync } from 'node:fs'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const PROD_PROJECT_REF = 'hwtzpfrnksksxlwwabqz'

type SupabaseClient = ReturnType<(typeof import('../lib/supabase'))['supabaseServer']>

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

/** The tab's cells, header first, as the Sheets API returns them (serial dates). */
async function readGoogleTab(spreadsheetId: string, tab: string): Promise<{ rows: unknown[][]; timeZone?: string }> {
  // Same identity and scopes as lib/google-sheets.ts (its auth helper is not exported).
  const { sheets } = await import('@googleapis/sheets')
  const { JWT } = await import('google-auth-library')
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('Google service account not configured; pass --file <tab.csv> instead.')
  const auth = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    subject: process.env.GOOGLE_IMPERSONATE_USER ?? process.env.GOOGLE_SHEET_OWNER_EMAIL ?? 'david.shaw@insimeducation.com',
  })
  const api = sheets({ version: 'v4', auth })
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'properties.timeZone,sheets.properties.title' })
  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title)
  if (!tabs.includes(tab)) throw new Error(`Tab "${tab}" not found. Tabs: ${tabs.join(', ')}`)
  const res = await api.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab.replace(/'/g, "''")}'`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  })
  return { rows: (res.data.values ?? []) as unknown[][], timeZone: meta.data.properties?.timeZone ?? undefined }
}

async function main() {
  const args = process.argv.slice(2)
  const year = argValue(args, '--sheet')
  const file = argValue(args, '--file')
  const apply = args.includes('--apply')
  const offline = args.includes('--offline')
  const allowProd = args.includes('--prod')
  if (apply && offline) throw new Error('--apply and --offline cannot be combined.')

  const m = await import('../lib/survey/legacy-mapping')
  if (year !== '2024' && year !== '2026') {
    throw new Error('Usage: npm run survey:import-legacy -- --sheet 2024|2026 [--tab <name>] [--file <tab.csv>] [--apply] [--offline] [--prod]')
  }
  const sheet = m.LEGACY_SHEETS[year]
  const tab = argValue(args, '--tab') ?? sheet.defaultTab
  if (![sheet.defaultTab, ...sheet.otherTabs].includes(tab)) {
    throw new Error(`Tab "${tab}" is not in the ${year} mapping (${[sheet.defaultTab, ...sheet.otherTabs].join(', ')}).`)
  }

  // ── Read ──
  let rows: unknown[][]
  if (file) {
    if (/\.xlsx?$/i.test(file)) throw new Error('XLSX is not read here. Export the tab as CSV (File → Download → CSV), or omit --file to read the Google Sheet directly.')
    rows = m.parseCsv(readFileSync(file, 'utf8'))
    console.log(`Source: ${file} (CSV, treated as tab "${tab}")`)
  } else {
    const g = await readGoogleTab(sheet.spreadsheetId, tab)
    rows = g.rows
    console.log(`Source: Google Sheet "${sheet.title}" / "${tab}"`)
    if (g.timeZone && g.timeZone !== sheet.timeZone) {
      throw new Error(`Sheet time zone is ${g.timeZone}, mapping says ${sheet.timeZone}. Update the mapping first.`)
    }
  }
  if (!rows.length) throw new Error('The tab is empty.')

  // ── Map ──
  const resolved = m.resolveHeaders(sheet, rows[0])
  if (resolved.unknown.length) {
    throw new Error(`Columns with no mapping (add them to lib/survey/legacy-mapping.ts and the mapping doc):\n  - ${resolved.unknown.join('\n  - ')}`)
  }
  const headerless = rows.slice(1).some((r) => r.some((c, i) => !resolved.columns[i] && m.normaliseText(c) && !m.normaliseText(rows[0][i])))
  if (headerless) throw new Error('A column with no header has data. Fix the sheet or the export first.')

  const responses: import('../lib/survey/legacy-mapping').LegacyResponse[] = []
  let blank = 0
  rows.slice(1).forEach((cells, i) => {
    const r = m.rowToResponse(sheet, tab, resolved, cells, i + 2)
    if (r) responses.push(r)
    else blank++
  })
  const noTimestamp = responses.filter((r) => !r.submitted_at)
  const importable = responses.filter((r) => r.submitted_at)

  const perKey = new Map<string, number>()
  for (const r of importable) for (const a of r.answers) perKey.set(a.question_key, (perKey.get(a.question_key) ?? 0) + 1)
  const unknownLabels = new Map<string, number>()
  for (const r of importable) for (const u of r.unknownLabels) unknownLabels.set(`${u.key} = "${u.label}"`, (unknownLabels.get(`${u.key} = "${u.label}"`) ?? 0) + 1)
  const roles = new Map<string, number>()
  for (const r of importable) {
    const k = r.respondent_role ?? (r.unmappedRole ? `null (label "${r.unmappedRole}")` : 'null')
    roles.set(k, (roles.get(k) ?? 0) + 1)
  }
  const years = new Map<number | null, number>()
  for (const r of importable) years.set(r.event_year, (years.get(r.event_year) ?? 0) + 1)
  const answers = importable.reduce((n, r) => n + r.answers.length, 0)
  const dates = importable.map((r) => r.submitted_at!.toISOString()).sort()

  console.log(`\n${sheet.title} / ${tab}`)
  console.log(`  sheet rows (excl. header): ${rows.length - 1}   blank: ${blank}   with data: ${responses.length}`)
  console.log(`  importable: ${importable.length}   no/invalid timestamp (skipped): ${noTimestamp.length}${noTimestamp.length ? ` — rows ${noTimestamp.map((r) => r.row).join(', ')}` : ''}`)
  console.log(`  answers: ${answers}   distinct keys used: ${perKey.size} of ${m.catalogRows(sheet).length} mapped`)
  if (dates.length) console.log(`  submitted: ${dates[0].slice(0, 10)} … ${dates[dates.length - 1].slice(0, 10)}`)
  console.log(`  event_year: ${[...years].map(([y, n]) => `${y}=${n}`).join(', ')}   event_slug: null (not mapped)`)
  console.log(`  respondent_role: ${[...roles].map(([k, n]) => `${k}=${n}`).join(', ')}`)
  if (resolved.missing.length) console.log(`  mapped columns not on this tab: ${resolved.missing.map((c) => c.header.slice(0, 60)).join(' | ')}`)
  console.log(`  scale labels outside their scale: ${unknownLabels.size ? '' : 'none'}`)
  for (const [k, n] of unknownLabels) console.log(`    ${k} ×${n}`)
  console.log(`  sample keys (answer count):`)
  for (const [k, n] of [...perKey].slice(0, 12)) console.log(`    ${k}  ${n}`)
  if (perKey.size > 12) console.log(`    … ${perKey.size - 12} more`)
  if (importable[0]) {
    const first = importable[0]
    const scored = first.answers.filter((a) => a.value_numeric !== null).slice(0, 3)
    console.log(`  sample row ${first.row}: ${first.legacy_ref}`)
    for (const a of scored) console.log(`    ${a.question_key} → "${a.value_text}" (${a.value_numeric})`)
  }

  if (offline) {
    console.log('\nDRY RUN (offline): the database was not read. Nothing written.')
    return
  }

  // ── Database ──
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  if (url.includes(PROD_PROJECT_REF) && !allowProd) {
    throw new Error('This points at PRODUCTION. Re-run with --prod if that is intended.')
  }
  const { supabaseServer } = await import('../lib/supabase')
  const { definitionSha256 } = await import('../lib/survey/definition-hash')
  const db = supabaseServer()

  const definition = m.legacyDefinition(sheet)
  const sha = definitionSha256(definition)
  const { data: defRow, error: defErr } = await db
    .from('survey_definitions')
    .select('id, status, definition_sha256')
    .eq('key', definition.key)
    .eq('version', definition.version)
    .maybeSingle()
  if (defErr) throw new Error(`Reading survey_definitions failed: ${defErr.message}`)
  if (defRow && defRow.definition_sha256 !== sha) {
    throw new Error(`${definition.key} v1 exists with a different mapping (sha ${String(defRow.definition_sha256).slice(0, 12)}…, now ${sha.slice(0, 12)}…). A mapping change after import needs a new version and a decision on the rows already imported.`)
  }

  const prefix = `${sheet.spreadsheetId}:${tab}:`
  const existing = new Map<string, string | null>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('survey_responses')
      .select('legacy_ref, submitted_at')
      .eq('source', 'legacy_import')
      .like('legacy_ref', `${prefix.replace(/[%_\\]/g, '\\$&')}%`)
      .range(from, from + 999)
    if (error) throw new Error(`Reading existing legacy rows failed: ${error.message}`)
    for (const r of data ?? []) existing.set(r.legacy_ref as string, r.submitted_at as string | null)
    if (!data || data.length < 1000) break
  }
  const toInsert = importable.filter((r) => !existing.has(r.legacy_ref))
  const incomplete = [...existing].filter(([, at]) => !at).map(([ref]) => ref)

  console.log(`\n  definition ${definition.key} v1: ${defRow ? `exists (${defRow.id})` : 'to create (published)'}, sha256 ${sha.slice(0, 12)}…`)
  console.log(`  already imported: ${existing.size}   to insert: ${toInsert.length}`)
  if (incomplete.length) console.log(`  ⚠ ${incomplete.length} imported row(s) never got submitted_at: ${incomplete.join(', ')}`)

  if (!apply) {
    console.log('\nDRY RUN: nothing written. Re-run with --apply once David has approved docs/survey/legacy-mapping.md.')
    return
  }

  // 1. Placeholder definition.
  let definitionId = defRow?.id as string | undefined
  if (!definitionId) {
    const now = new Date().toISOString()
    const { data, error } = await db
      .from('survey_definitions')
      .insert({
        key: definition.key,
        version: definition.version,
        title: definition.title,
        definition,
        definition_sha256: sha,
        status: 'published',
        published_at: now,
        published_by: 'survey-import-legacy',
      })
      .select('id')
      .single()
    if (error) throw new Error(`Creating the ${definition.key} definition failed: ${error.message}`)
    definitionId = data.id as string
    console.log(`Created ${definition.key} v1 (${definitionId}).`)
  }

  // 2. Catalog.
  const now = new Date().toISOString()
  const { error: catErr } = await db
    .from('survey_question_catalog')
    .upsert(m.catalogRows(sheet).map((r) => ({ ...r, updated_at: now })), { onConflict: 'question_key' })
  if (catErr) throw new Error(`Catalog update failed: ${catErr.message}`)
  console.log(`Catalog: ${m.catalogRows(sheet).length} ${definition.key} keys.`)

  // 3. Responses and answers.
  let done = 0
  const failed: string[] = []
  for (const r of toInsert) {
    const { data: resp, error: rErr } = await db
      .from('survey_responses')
      .insert({
        definition_id: definitionId,
        source: 'legacy_import',
        legacy_ref: r.legacy_ref,
        event_year: r.event_year,
        respondent_role: r.respondent_role,
        context: { legacy: { spreadsheet_id: sheet.spreadsheetId, tab, row: r.row } },
      })
      .select('id')
      .single()
    if (rErr) {
      failed.push(`${r.legacy_ref}: ${rErr.message}`)
      continue
    }
    const id = resp.id as string
    if (r.answers.length) {
      const { error: aErr } = await db.from('survey_answers').insert(r.answers.map((a) => ({ response_id: id, ...a })))
      if (aErr) {
        await db.from('survey_responses').delete().eq('id', id) // not yet submitted: no audit trace, cascades answers
        failed.push(`${r.legacy_ref}: answers: ${aErr.message}`)
        continue
      }
    }
    const at = r.submitted_at!.toISOString()
    const { error: sErr } = await db.from('survey_responses').update({ submitted_at: at, last_saved_at: at }).eq('id', id)
    if (sErr) {
      failed.push(`${r.legacy_ref}: submitted_at: ${sErr.message} (row left unsubmitted; re-run reports it)`)
      continue
    }
    done++
  }
  console.log(`Imported ${done} of ${toInsert.length} response(s).`)
  if (failed.length) {
    console.error(`Failed ${failed.length}:\n  ${failed.join('\n  ')}`)
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
