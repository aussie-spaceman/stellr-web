import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { normaliseDefinition, catalogEntries } from './definition'
import {
  LEGACY_2024,
  LEGACY_2026,
  LEGACY_SHEETS,
  catalogRows,
  legacyDefinition,
  legacyRef,
  mapRole,
  parseCsv,
  parseTimestamp,
  resolveHeaders,
  rowToResponse,
  transformCell,
  type ColumnMap,
} from './legacy-mapping'

const appKeys = new Set(
  catalogEntries(normaliseDefinition(JSON.parse(readFileSync('lib/survey/definitions/post_event.v1.json', 'utf8')))).map((e) => e.question_key),
)

function col(sheet: typeof LEGACY_2024, key: string): ColumnMap {
  const c = sheet.columns.find((x) => x.target.kind === 'answer' && x.target.key === key)
  if (!c) throw new Error(key)
  return c
}

describe('mapping data', () => {
  for (const sheet of Object.values(LEGACY_SHEETS)) {
    it(`${sheet.year}: keys are unique, prefixed, and never an app key`, () => {
      const keys = catalogRows(sheet).map((r) => r.question_key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const k of keys) {
        expect(k).toMatch(new RegExp(`^legacy_${sheet.year}\\.[a-z0-9_]+$`))
        expect(appKeys.has(k)).toBe(false)
      }
    })

    it(`${sheet.year}: headers are unique and every candidate is a real app key`, () => {
      const headers = sheet.columns.flatMap((c) => [c.header, ...(c.aliases ?? [])].map((h) => h.toLowerCase()))
      expect(new Set(headers).size).toBe(headers.length)
      for (const c of sheet.columns) if (c.candidate) expect(appKeys.has(c.candidate), c.candidate).toBe(true)
    })

    it(`${sheet.year}: placeholder definition key is valid and catalog source matches`, () => {
      const def = legacyDefinition(sheet)
      expect(def.key).toMatch(/^[a-z0-9_]+$/)
      expect(def.version).toBe(1)
      expect(def.columns).toHaveLength(sheet.columns.length)
      for (const r of catalogRows(sheet)) expect(r.source).toBe(`legacy_${sheet.year}`)
    })
  }

  it('column counts match the sheets as read on 2 Oct 2026', () => {
    expect(LEGACY_2024.columns).toHaveLength(52)
    expect(LEGACY_2026.columns).toHaveLength(42)
  })
})

describe('transformCell', () => {
  it('scores legacy scales case- and space-insensitively and keeps the canonical label', () => {
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.felt_bonding'), ' strongly  agree ')?.answer).toEqual({
      question_key: 'legacy_2024.felt_bonding',
      value_text: 'Strongly Agree',
      value_numeric: 6,
      value_options: null,
    })
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.helpful_rfp'), 'Very Helpful')?.answer.value_numeric).toBe(4)
    expect(transformCell(col(LEGACY_2026, 'legacy_2026.help_bounce_back'), 'To a great extent')?.answer.value_numeric).toBe(4)
  })

  it('N/A-style answers keep their text with no score', () => {
    const r = transformCell(col(LEGACY_2024, 'legacy_2024.vs_chess'), 'N/A')
    expect(r?.answer).toMatchObject({ value_text: 'N/A', value_numeric: null })
    expect(r?.unknownLabel).toBeUndefined()
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.helpful_red_team'), 'I did not use this resource')?.answer.value_numeric).toBeNull()
  })

  it('an unexpected label in a scale column is kept as text and flagged', () => {
    const r = transformCell(col(LEGACY_2024, 'legacy_2024.felt_purpose'), 'Neutral')
    expect(r?.answer).toMatchObject({ value_text: 'Neutral', value_numeric: null })
    expect(r?.unknownLabel).toBe('Neutral')
  })

  it('empty cells produce no answer; free text keeps line breaks', () => {
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.other_feedback'), '  ')).toBeNull()
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.other_feedback'), undefined)).toBeNull()
    expect(transformCell(col(LEGACY_2024, 'legacy_2024.other_feedback'), ' a\nb ')?.answer.value_text).toBe('a\nb')
  })
})

describe('mapRole', () => {
  it('maps only known labels', () => {
    expect(mapRole('Student')).toBe('student')
    expect(mapRole(' student ')).toBe('student')
    expect(mapRole('Volunteer')).toBeNull()
    expect(mapRole('')).toBeNull()
  })
})

describe('parseTimestamp', () => {
  it('reads a Sheets serial as wall clock in the sheet zone', () => {
    // 05/04/2024 15:48:19 in America/Boise (MDT, UTC-6).
    const d = parseTimestamp(45387.65855746528, 'America/Boise', 'dmy')
    expect(d?.toISOString()).toBe('2024-04-05T21:48:19.365Z')
  })

  it('reads en_GB and ISO text forms', () => {
    expect(parseTimestamp('05/04/2024 15:48:19', 'America/Boise', 'dmy')?.toISOString()).toBe('2024-04-05T21:48:19.000Z')
    expect(parseTimestamp('04/05/2024 15:48:19', 'America/Boise', 'mdy')?.toISOString()).toBe('2024-04-05T21:48:19.000Z')
    expect(parseTimestamp('2024-01-18 20:47:19.962', 'America/Boise', 'dmy')?.toISOString()).toBe('2024-01-19T03:47:19.962Z')
  })

  it('rejects junk', () => {
    expect(parseTimestamp('', 'America/Boise', 'dmy')).toBeNull()
    expect(parseTimestamp('yesterday', 'America/Boise', 'dmy')).toBeNull()
    expect(parseTimestamp('13/13/2024 10:00:00', 'America/Boise', 'dmy')).toBeNull()
  })
})

describe('resolveHeaders + rowToResponse', () => {
  const headers = [
    'Timestamp',
    'In what way did you participate in the event?',
    'How would you rate your overall experience at the Design Competition you participated in?  ',
    'To what extent did participating in this event help:  [Bounce back from setbacks and disappointments?]',
    'What were the highlights of your experience at the event you attended? ',
    '',
  ]

  it('matches headers after whitespace collapse and reports unknown and missing ones', () => {
    const r = resolveHeaders(LEGACY_2026, [...headers, 'Email address'])
    expect(r.columns.filter(Boolean)).toHaveLength(5)
    expect(r.unknown).toEqual(['Email address'])
    expect(r.missing).toHaveLength(LEGACY_2026.columns.length - 5)
  })

  it('accepts the South West tab facilities header as an alias', () => {
    const r = resolveHeaders(LEGACY_2024, ['Timestamp', 'Do you have any feedback about the facilities (BioSphere2)?'])
    expect(r.unknown).toEqual([])
    expect(r.columns[1]?.target).toMatchObject({ key: 'legacy_2024.facilities_feedback' })
  })

  it('builds a response with legacy keys, role, year and a stable legacy_ref', () => {
    const resolved = resolveHeaders(LEGACY_2026, headers)
    const r = rowToResponse(LEGACY_2026, 'Form responses 1', resolved, ['05/04/2026 10:00:00', 'Student', 'Excellent', 'Somewhat', 'Text'], 7)
    expect(r).not.toBeNull()
    expect(r!.legacy_ref).toBe(`${LEGACY_2026.spreadsheetId}:Form responses 1:7`)
    expect(r!.legacy_ref).toBe(legacyRef(LEGACY_2026, 'Form responses 1', 7))
    expect(r!.event_year).toBe(2026)
    expect(r!.respondent_role).toBe('student')
    expect(r!.answers.map((a) => a.question_key)).toEqual([
      'legacy_2026.participation',
      'legacy_2026.overall_experience',
      'legacy_2026.help_bounce_back',
      'legacy_2026.highlights',
    ])
    expect(r!.answers.every((a) => !appKeys.has(a.question_key))).toBe(true)
    expect(r!.answers.find((a) => a.question_key === 'legacy_2026.help_bounce_back')?.value_numeric).toBe(3)
  })

  it('records an unmapped role label and returns null for a blank row', () => {
    const resolved = resolveHeaders(LEGACY_2026, headers)
    const r = rowToResponse(LEGACY_2026, 'Form responses 1', resolved, ['05/04/2026 10:00:00', 'Volunteer'], 3)
    expect(r!.respondent_role).toBeNull()
    expect(r!.unmappedRole).toBe('Volunteer')
    expect(rowToResponse(LEGACY_2026, 'Form responses 1', resolved, ['', ' ', undefined], 4)).toBeNull()
  })
})

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines and CRLF', () => {
    expect(parseCsv('﻿a,b,c\r\n"x, y","he said ""hi""","line1\nline2"\r\n,,\n')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'line1\nline2'],
      ['', '', ''],
    ])
  })
  it('keeps a last row with no trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})
