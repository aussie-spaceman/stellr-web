/**
 * Legacy Google Forms post-event surveys → survey_responses / survey_answers
 * (handover §9; reviewed mapping: docs/survey/legacy-mapping.md).
 *
 * The mapping is data, so the doc, the dry run and the import all read the
 * same thing. A column goes to an app question key only when the question and
 * its answer labels match the app's; every other column keeps its own
 * `legacy_<year>.*` key, so nothing is lost and nothing is falsely compared.
 * No column is mapped to an app key yet: each near-match is recorded as a
 * `candidate` for David to approve (or not) before any --apply.
 *
 * Pure: no I/O. Read and write in scripts/survey-import-legacy.ts.
 */
import { zonedTimeToUtc } from './timezone'

// ── Scales ───────────────────────────────────────────────────────────────────

export interface ScaleOption {
  label: string
  /** Higher = more positive; null for "N/A"-style answers. */
  numeric: number | null
}

/** The legacy forms' own answer scales, scored within each scale only. */
export const LEGACY_SCALES = {
  /** 2024 "At this competition I experienced or felt…" and similar grids. */
  agree6: [
    { label: 'Strongly Disagree', numeric: 1 },
    { label: 'Moderately Disagree', numeric: 2 },
    { label: 'Slightly Disagree', numeric: 3 },
    { label: 'Slightly Agree', numeric: 4 },
    { label: 'Moderately Agree', numeric: 5 },
    { label: 'Strongly Agree', numeric: 6 },
  ],
  /** 2024 "Compared with other cognitive competitions…" */
  compare5: [
    { label: 'Much Less', numeric: 1 },
    { label: 'Less', numeric: 2 },
    { label: 'Equal', numeric: 3 },
    { label: 'Greater', numeric: 4 },
    { label: 'Much Greater', numeric: 5 },
    { label: 'N/A', numeric: null },
  ],
  /** 2024 "How helpful were the following resources…" */
  helpful4: [
    { label: 'Not at all helpful', numeric: 1 },
    { label: 'A little helpful', numeric: 2 },
    { label: 'Moderately helpful', numeric: 3 },
    { label: 'Very Helpful', numeric: 4 },
    { label: 'I did not use this resource', numeric: null },
  ],
  /**
   * 2026 "To what extent did participating in this event help…". Same shape as
   * the app's extent4 but the top label differs ("To a great extent" vs "A
   * great deal"), so it stays a legacy scale.
   */
  extent4_2026: [
    { label: 'Not at all', numeric: 1 },
    { label: 'Slightly', numeric: 2 },
    { label: 'Somewhat', numeric: 3 },
    { label: 'To a great extent', numeric: 4 },
  ],
} as const satisfies Record<string, readonly ScaleOption[]>

export type LegacyScaleName = keyof typeof LEGACY_SCALES

// ── Column mapping ───────────────────────────────────────────────────────────

export type AnswerType = 'scale' | 'single' | 'text_short' | 'text_long'

export type ColumnTarget =
  /** Response timestamp → submitted_at and event_year. Not an answer. */
  | { kind: 'timestamp' }
  /** Kept as an answer under `key`. */
  | { kind: 'answer'; key: string; type: AnswerType; scale?: LegacyScaleName }

export interface ColumnMap {
  /** The column header, whitespace-collapsed. Also the catalog label. */
  header: string
  /** Other headers for the same column (e.g. the same question on another tab). */
  aliases?: string[]
  target: ColumnTarget
  /** Also read this column as the respondent's role (survey_responses.respondent_role). */
  role?: boolean
  /** The app key this could map to if David approves; not applied. */
  candidate?: string
  note?: string
}

export interface LegacySheet {
  /** --sheet value and catalog source suffix. */
  year: '2024' | '2026'
  /** survey_definitions.key and survey_question_catalog.source. */
  definitionKey: 'legacy_2024' | 'legacy_2026'
  spreadsheetId: string
  title: string
  defaultTab: string
  /** Other tabs with the same question set that may be imported with --tab. */
  otherTabs: string[]
  /** The spreadsheet's own zone and locale (read from the Sheets API, 2 Oct 2026). */
  timeZone: string
  /** How a CSV export writes dates: en_GB → day/month/year. */
  dateOrder: 'dmy' | 'mdy'
  columns: ColumnMap[]
  /** Headers deliberately not imported (personal data). None in either sheet. */
  dropped: { header: string; reason: string }[]
}

function grid(
  stem: string,
  keyPrefix: string,
  rows: [suffix: string, label: string, extra?: Partial<ColumnMap>][],
  type: AnswerType,
  scale?: LegacyScaleName,
): ColumnMap[] {
  return rows.map(([suffix, label, extra]) => ({
    header: `${stem} [${label}]`,
    target: { kind: 'answer', key: `${keyPrefix}${suffix}`, type, ...(scale ? { scale } : {}) },
    ...extra,
  }))
}

const S24 = 'legacy_2024.'
const S26 = 'legacy_2026.'

const COMPARE_STEM =
  'Compared with other cognitive competitions, the values of Space Design Competition to me is ____ than the other programs listed below: (Choose N/A if you have no experience with the listed program.)'

export const LEGACY_2024: LegacySheet = {
  year: '2024',
  definitionKey: 'legacy_2024',
  spreadsheetId: '1d-_03xH-ylnywbZ67muiyZN3wQGhXKMmvYS_JH8ZQ2Q',
  title: '2024 Competitions - Post Event Survey Responses',
  defaultTab: 'ALL EVENTS',
  otherTabs: ['South West'],
  timeZone: 'America/Boise',
  dateOrder: 'dmy',
  dropped: [],
  columns: [
    { header: 'Timestamp', target: { kind: 'timestamp' } },
    {
      header: 'Which Event Did You Attend This Year?',
      target: { kind: 'answer', key: `${S24}event_attended`, type: 'single' },
      note: 'Region labels, not event slugs; event_slug left null.',
    },
    ...grid('At this competition I experienced or felt', `${S24}felt_`, [
      ['bonding', 'Bonding with others'],
      ['peer_influence', 'Positive peer influence'],
      ['high_expectations', 'High Expectations'],
      ['motivation', 'Motivation to achieve'],
      ['engaged', 'Engaged by the activity'],
      ['responsibility', 'Responsibility for my part'],
      ['planning', 'Importance of planning'],
      ['decision_making', 'Decision making'],
      ['interpersonal', 'interpersonal skills'],
      ['cross_cultural', 'Cross-cultural awareness'],
      ['conflict_resolution', 'Conflict resolution'],
      ['purpose', 'A sense of purpose'],
      ['competence', 'A sense of competence'],
      ['positive_outlook', 'A positive outlook on the future'],
    ], 'scale', 'agree6'),
    ...grid('At this competition I felt challenged to develop and/or apply my:', `${S24}challenged_`, [
      ['creativity', 'Creativity', { candidate: 'skill_creativity', note: 'Agree scale, not extent4; different question.' }],
      ['communication', 'Communication skills', { candidate: 'skill_oral_comm', note: 'Agree scale, not extent4; different question.' }],
      ['knowledge', 'Knowledge of facts'],
      ['comprehension', 'Comprehension of ideas'],
      ['analysis', 'Analysis (breakdown) of ideas'],
      ['synthesis', 'Synthesis (combining) of ideas'],
      ['application', 'Application of ideas to real problems'],
      ['evaluation', 'Evaluation of ideas'],
    ], 'scale', 'agree6'),
    ...grid('Because of my experience at this competition I feel that I will be more likely to:', `${S24}likely_`, [
      ['stem_major', 'Choose major in science and/or engineering', { candidate: 'stem_intent_after', note: 'Agree scale, not likely5; asks about change, not intent.' }],
      ['stem_career', 'Choose career path/science/engineering', { candidate: 'stem_intent_after', note: 'Agree scale, not likely5; asks about change, not intent.' }],
      ['teamwork', 'Participate better with teams'],
      ['proposals', 'Write better project proposals'],
      ['managing', 'Become a better manager of others'],
      ['academic_motivation', 'Experience more academic motivation'],
      ['leadership', 'Display personal leadership qualities'],
      ['success', 'Experience higher levels of success'],
    ], 'scale', 'agree6'),
    ...grid(COMPARE_STEM, `${S24}vs_`, [
      ['academic_decathlon', 'Academic Decathlon'],
      ['quiz_bowl', 'Quiz Bowl'],
      ['destination_imagination', 'Destination Imagination'],
      ['speech_debate', 'Speech and Debate'],
      ['model_un', 'Model United Nations'],
      ['science_fair', 'State Science Fair'],
      ['chess', 'Chess tournaments'],
      ['history_day', 'History Day Competition'],
      ['robotics', 'Robotics Competition'],
    ], 'scale', 'compare5'),
    ...grid('How helpful were the following resources during the competition?', `${S24}helpful_`, [
      ['ceos_volunteers', 'CEOs + Volunteers'],
      ['customer', 'Access to the Customer (Anita)'],
      ['internet', 'Internet search engine access'],
      ['program_book', 'The Program Book'],
      ['red_team', 'Red Team Reviews'],
      ['tech_sessions', 'Pre-recorded Technical Sessions'],
      ['rfp', 'The Request For Proposal (RFP) document'],
    ], 'scale', 'helpful4'),
    {
      header: 'Please provide feedback or suggestions for us about the catering for meals and snacks',
      target: { kind: 'answer', key: `${S24}catering_feedback`, type: 'text_long' },
    },
    {
      header: 'Do you have any feedback about the facilities (specific to your event location)?',
      aliases: ['Do you have any feedback about the facilities (BioSphere2)?'],
      target: { kind: 'answer', key: `${S24}facilities_feedback`, type: 'text_long' },
      note: 'The South West tab words this "(BioSphere2)".',
    },
    {
      header: 'If you competed in previous years, how did the 2024 experience compare? What things were better, or worse?',
      target: { kind: 'answer', key: `${S24}compare_previous_years`, type: 'text_long' },
    },
    {
      header: 'Any other feedback?',
      target: { kind: 'answer', key: `${S24}other_feedback`, type: 'text_long' },
      candidate: 'improve',
      note: 'Open "any other feedback", not "one thing to change".',
    },
  ],
}

const HELP = 'To what extent did participating in this event help:'

export const LEGACY_2026: LegacySheet = {
  year: '2026',
  definitionKey: 'legacy_2026',
  spreadsheetId: '1HRlNIeJY0zNEO_u7b38guJIVq1Ek9J9oLAJ19G15uEU',
  title: '2026 Post-Event Survey (Responses)',
  defaultTab: 'Form responses 1',
  otherTabs: [],
  timeZone: 'America/Boise',
  dateOrder: 'dmy',
  dropped: [],
  columns: [
    { header: 'Timestamp', target: { kind: 'timestamp' } },
    {
      header: 'In what way did you participate in the event?',
      target: { kind: 'answer', key: `${S26}participation`, type: 'single' },
      role: true,
      note: 'Also sets respondent_role for labels in ROLE_LABELS; others leave it null.',
    },
    {
      header: 'Please indicate your current grade level in school.',
      target: { kind: 'answer', key: `${S26}grade_level`, type: 'text_short' },
      candidate: 'demo_grade',
      note: 'Free text ("12th", "Gapyear…"), not the members.grade vocabulary.',
    },
    {
      header: 'How would you rate your overall experience at the Design Competition you participated in?',
      target: { kind: 'answer', key: `${S26}overall_experience`, type: 'single' },
      candidate: 'overall_rating',
      note: 'Full option list unconfirmed (only "Excellent", "Good" seen).',
    },
    {
      header:
        'If there was a facility tour at your venue (i.e. Biosphere in AZ, Museum of Flight in WA), did it enhance your learning experience and interest in the event?',
      target: { kind: 'answer', key: `${S26}facility_tour`, type: 'single' },
    },
    {
      header: 'Do you feel this event helped you see yourself as a successful STEM student or professional?',
      target: { kind: 'answer', key: `${S26}stem_identity`, type: 'single' },
    },
    ...grid(HELP, `${S26}help_`, [
      ['written_comm', 'Improve your written communication skills?'],
      ['oral_comm', 'Improve your oral communication skills (e.g., public speaking, active listening, giving presentations)?', { candidate: 'skill_oral_comm' }],
      ['interpersonal_comm', 'Improve your interpersonal communication skills (e.g. active listening, empathy, conflict resolution)?'],
    ], 'scale', 'extent4_2026'),
    {
      header: 'Did you enjoy working with your team members on the Request For Proposal (RFP)?',
      target: { kind: 'answer', key: `${S26}enjoyed_team`, type: 'single' },
    },
    {
      header: 'Briefly describe your experience with team members.',
      target: { kind: 'answer', key: `${S26}team_experience`, type: 'text_long' },
    },
    {
      header: 'Do you feel your team effectively collaborated and divided responsibilities?',
      target: { kind: 'answer', key: `${S26}team_collaborated`, type: 'single' },
    },
    {
      header: 'Briefly describe how your team collaborated and divided responsibilities.',
      target: { kind: 'answer', key: `${S26}team_collaboration`, type: 'text_long' },
    },
    // This block's stem has no colon in the form.
    ...grid('To what extent did participating in this event help', `${S26}help_`, [
      ['collaborate', 'Collaborate effectively with others on a team project?', { candidate: 'skill_teamwork' }],
      ['communicate_team', 'Communicate effectively with teammates?'],
      ['resolve_conflict', 'Resolve conflicts constructively in a team setting?'],
      ['diverse_backgrounds', 'Interact with people from diverse backgrounds?'],
    ], 'scale', 'extent4_2026'),
    {
      header: 'How did the event challenge you to think critically about complex issues and develop solutions?',
      target: { kind: 'answer', key: `${S26}critical_thinking`, type: 'text_long' },
    },
    ...grid(HELP, `${S26}help_`, [
      ['think_creatively', 'Think creatively and come up with new ideas or approaches to challenges?', { candidate: 'skill_creativity' }],
      ['identify_issues', 'Identify key issues and determine appropriate solutions?', { candidate: 'skill_problem_solving' }],
      ['evaluate_evidence', 'Evaluate evidence and arguments critically?'],
      ['creative_solutions', 'Develop and implement creative solutions to problems?'],
      ['locate_information', 'Locating and accessing relevant information'],
      ['analyze_sources', 'Analyzing and using information from multiple sources'],
      ['cite_ethically', 'Citing and referencing information ethically'],
      ['bounce_back', 'Bounce back from setbacks and disappointments?', { candidate: 'skill_resilience' }],
      ['adapt_change', 'Adapt to unexpected changes and challenges?'],
      ['self_efficacy', 'Develop a stronger sense of self-efficacy (belief in your ability to succeed)?', { candidate: 'skill_confidence' }],
      ['positive_outlook', 'Maintain a positive outlook even in difficult situations?'],
      ['adaptable', 'Be more adaptable and flexible in your approach to learning and work?'],
      ['time_management', 'Effectively prioritize tasks and improve your time management skills?', { candidate: 'skill_time_mgmt' }],
      ['manage_distractions', 'Manage distractions and focus on your work?'],
      ['accountability', 'Hold yourself accountable to meet your goals?'],
    ], 'scale', 'extent4_2026'),
    {
      header: 'Did the competition increase your interest in STEM fields?',
      target: { kind: 'answer', key: `${S26}stem_interest_increased`, type: 'single' },
    },
    {
      header: 'Did the interactions with professionals (college, industry etc) increase your interest in pursuing a career in STEM?',
      target: { kind: 'answer', key: `${S26}pro_interactions_career`, type: 'single' },
    },
    {
      header: 'Please explain.',
      target: { kind: 'answer', key: `${S26}pro_interactions_explain`, type: 'text_long' },
      note: 'Follows the professionals question.',
    },
    {
      header: 'Did the competition provide you with valuable insights into different career paths within the STEM fields?',
      target: { kind: 'answer', key: `${S26}career_insights`, type: 'single' },
    },
    {
      header: 'Please describe how this competition may have impacted your views on STEM careers and opportunities',
      target: { kind: 'answer', key: `${S26}career_views_impact`, type: 'text_long' },
    },
    {
      header: 'How would you rate your overall experience at the Design Competition you attended?',
      target: { kind: 'answer', key: `${S26}overall_experience_attended`, type: 'single' },
      candidate: 'overall_rating',
      note: 'Second overall-rating column (no answers yet); option list unconfirmed.',
    },
    {
      header: 'What were the highlights of your experience at the event you attended?',
      target: { kind: 'answer', key: `${S26}highlights`, type: 'text_long' },
      candidate: 'highlight',
    },
    {
      header: 'What changes would you recommend to improve the competition for future participants?',
      target: { kind: 'answer', key: `${S26}recommended_changes`, type: 'text_long' },
      candidate: 'improve',
    },
    {
      header: 'Other comments or feedback about the competition?',
      target: { kind: 'answer', key: `${S26}other_comments`, type: 'text_long' },
    },
  ],
}

export const LEGACY_SHEETS: Record<'2024' | '2026', LegacySheet> = { '2024': LEGACY_2024, '2026': LEGACY_2026 }

/**
 * Participation labels → respondent_role. Only labels seen or certain; any
 * other label leaves respondent_role null (the raw answer is still kept).
 */
export const ROLE_LABELS: Record<string, 'student' | 'mentor' | 'adult'> = {
  student: 'student',
}

// ── Pure transforms ──────────────────────────────────────────────────────────

/** Trim and collapse runs of whitespace. Header and label comparisons use this. */
export function normaliseText(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function fold(s: string): string {
  return normaliseText(s).toLowerCase()
}

export function mapRole(raw: unknown): 'student' | 'mentor' | 'adult' | null {
  const v = fold(String(raw ?? ''))
  return ROLE_LABELS[v] ?? null
}

export interface AnswerRow {
  question_key: string
  value_text: string | null
  value_numeric: number | null
  value_options: string[] | null
}

export interface CellResult {
  answer: AnswerRow
  /** Set when a scale column held a label outside its scale. */
  unknownLabel?: string
}

/** One cell → one answer row, or null when the cell is empty. */
export function transformCell(col: ColumnMap, raw: unknown): CellResult | null {
  if (col.target.kind !== 'answer') return null
  const text = normaliseText(raw)
  if (!text) return null
  const { key, scale } = col.target
  if (scale) {
    const hit = (LEGACY_SCALES[scale] as readonly ScaleOption[]).find((o) => fold(o.label) === fold(text))
    if (hit) return { answer: { question_key: key, value_text: hit.label, value_numeric: hit.numeric, value_options: null } }
    return { answer: { question_key: key, value_text: text, value_numeric: null, value_options: null }, unknownLabel: text }
  }
  // Free text keeps its line breaks; only the ends are trimmed.
  const value = col.target.type === 'text_long' || col.target.type === 'text_short' ? String(raw).trim() : text
  return { answer: { question_key: key, value_text: value, value_numeric: null, value_options: null } }
}

/**
 * A timestamp cell → instant. Accepts a Sheets serial (days since
 * 1899-12-30, wall clock in the sheet's zone), a Date (wall clock already
 * applied by the reader), "YYYY-MM-DD HH:MM:SS[.fff]", or "DD/MM/YYYY
 * HH:MM:SS" / "MM/DD/YYYY HH:MM:SS" per `dateOrder`. Wall-clock forms are read
 * in `tz`.
 */
export function parseTimestamp(raw: unknown, tz: string, dateOrder: 'dmy' | 'mdy'): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw
  let y: number, mo: number, d: number, h = 0, mi = 0, sec = 0
  if (typeof raw === 'number' && isFinite(raw)) {
    const wall = new Date(Math.round((raw - 25569) * 86400_000))
    y = wall.getUTCFullYear()
    mo = wall.getUTCMonth() + 1
    d = wall.getUTCDate()
    h = wall.getUTCHours()
    mi = wall.getUTCMinutes()
    sec = wall.getUTCSeconds() + wall.getUTCMilliseconds() / 1000
  } else {
    const s = normaliseText(raw)
    if (!s) return null
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/)
    if (m) {
      ;[y, mo, d] = [+m[1], +m[2], +m[3]]
    } else {
      m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/)
      if (!m) return null
      ;[d, mo] = dateOrder === 'dmy' ? [+m[1], +m[2]] : [+m[2], +m[1]]
      y = +m[3]
    }
    h = m[4] ? +m[4] : 0
    mi = m[5] ? +m[5] : 0
    sec = m[6] ? +m[6] : 0
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec >= 61) return null
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const base = zonedTimeToUtc(date, tz, h, mi)
  return new Date(base.getTime() + Math.round(sec * 1000))
}

/** Calendar year of an instant in `tz`. */
export function yearInZone(at: Date, tz: string): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric' }).format(at))
}

export interface ResolvedHeaders {
  /** Per sheet column: its mapping, or null (blank header). */
  columns: (ColumnMap | null)[]
  /** Non-blank headers with no mapping: the import refuses to run. */
  unknown: string[]
  /** Mapped columns absent from this tab. */
  missing: ColumnMap[]
}

export function resolveHeaders(sheet: LegacySheet, headers: unknown[]): ResolvedHeaders {
  const byHeader = new Map<string, ColumnMap>()
  for (const c of sheet.columns) for (const h of [c.header, ...(c.aliases ?? [])]) byHeader.set(fold(h), c)
  const dropped = new Set(sheet.dropped.map((d) => fold(d.header)))
  const unknown: string[] = []
  const seen = new Set<ColumnMap>()
  const columns = headers.map((h) => {
    const t = normaliseText(h)
    if (!t || dropped.has(fold(t))) return null
    const c = byHeader.get(fold(t))
    if (!c) {
      unknown.push(t)
      return null
    }
    seen.add(c)
    return c
  })
  return { columns, unknown, missing: sheet.columns.filter((c) => !seen.has(c)) }
}

export function legacyRef(sheet: LegacySheet, tab: string, rowNumber: number): string {
  return `${sheet.spreadsheetId}:${tab}:${rowNumber}`
}

export interface LegacyResponse {
  legacy_ref: string
  /** 1-based sheet row (header = row 1). */
  row: number
  submitted_at: Date | null
  event_year: number | null
  respondent_role: 'student' | 'mentor' | 'adult' | null
  /** The raw participation label when it did not map to a role. */
  unmappedRole?: string
  answers: AnswerRow[]
  unknownLabels: { key: string; label: string }[]
}

/**
 * One sheet row → one legacy response, or null for a blank row. `rowNumber`
 * is the sheet row, so the legacy_ref is the same whichever way the tab is read.
 */
export function rowToResponse(
  sheet: LegacySheet,
  tab: string,
  resolved: ResolvedHeaders,
  cells: unknown[],
  rowNumber: number,
): LegacyResponse | null {
  if (!cells.some((c) => normaliseText(c))) return null
  const out: LegacyResponse = {
    legacy_ref: legacyRef(sheet, tab, rowNumber),
    row: rowNumber,
    submitted_at: null,
    event_year: null,
    respondent_role: null,
    answers: [],
    unknownLabels: [],
  }
  resolved.columns.forEach((col, i) => {
    if (!col) return
    const raw = cells[i]
    if (col.target.kind === 'timestamp') {
      out.submitted_at = parseTimestamp(raw, sheet.timeZone, sheet.dateOrder)
      out.event_year = out.submitted_at ? yearInZone(out.submitted_at, sheet.timeZone) : null
      return
    }
    const res = transformCell(col, raw)
    if (!res) return
    out.answers.push(res.answer)
    if (res.unknownLabel) out.unknownLabels.push({ key: res.answer.question_key, label: res.unknownLabel })
    if (col.role) {
      out.respondent_role = mapRole(raw)
      if (!out.respondent_role) out.unmappedRole = normaliseText(raw)
    }
  })
  return out
}

// ── Definition placeholder and catalog ───────────────────────────────────────

/**
 * The published placeholder definition legacy responses hang off
 * (survey_responses.definition_id is NOT NULL). It records the mapping, so a
 * later change to the mapping changes the hash and is refused by the importer
 * instead of silently re-describing imported rows.
 */
export function legacyDefinition(sheet: LegacySheet) {
  return {
    key: sheet.definitionKey,
    version: 1,
    title: `${sheet.year} Google Forms post-event survey (imported)`,
    source_sheet: {
      spreadsheet_id: sheet.spreadsheetId,
      title: sheet.title,
      tabs: [sheet.defaultTab, ...sheet.otherTabs],
      time_zone: sheet.timeZone,
    },
    scales: Object.fromEntries(
      [...new Set(sheet.columns.flatMap((c) => (c.target.kind === 'answer' && c.target.scale ? [c.target.scale] : [])))].map((s) => [
        s,
        LEGACY_SCALES[s],
      ]),
    ),
    columns: sheet.columns.map((c) => ({
      header: c.header,
      ...(c.aliases ? { aliases: c.aliases } : {}),
      target: c.target.kind === 'timestamp' ? 'submitted_at' : c.target.key,
      ...(c.target.kind === 'answer' ? { type: c.target.type } : {}),
      ...(c.target.kind === 'answer' && c.target.scale ? { scale: c.target.scale } : {}),
      ...(c.role ? { also: 'respondent_role' } : {}),
    })),
    dropped: sheet.dropped,
  }
}

export interface LegacyCatalogRow {
  question_key: string
  label: string
  type: string
  options: unknown
  survey_key: string
  first_version: number
  last_version: number
  source: 'legacy_2024' | 'legacy_2026'
}

export function catalogRows(sheet: LegacySheet): LegacyCatalogRow[] {
  return sheet.columns.flatMap((c) =>
    c.target.kind === 'answer'
      ? [
          {
            question_key: c.target.key,
            label: c.header,
            type: c.target.type,
            options: c.target.scale ? LEGACY_SCALES[c.target.scale] : null,
            survey_key: sheet.definitionKey,
            first_version: 1,
            last_version: 1,
            source: sheet.definitionKey,
          },
        ]
      : [],
  )
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** RFC 4180 CSV → rows of cells. Quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}
