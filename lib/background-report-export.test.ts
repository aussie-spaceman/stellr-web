import { describe, it, expect, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { BackgroundCheck, MemberComplianceRecords, TeacherLicense } from './compliance'
import { ReportPdfUnavailableError, type BackgroundProvider } from './background-provider'
import {
  buildMentorReportPdf,
  classifyMentor,
  coverPageCount,
  exportModeFor,
  fittedFontSize,
  fileSlug,
  logReportExport,
  pdfSafe,
  type EventMentor,
  type MentorRow,
} from './background-report-export'

vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn(async () => {}) }))

// Who gets a Checkr report in the export, and what the export does when Checkr
// can't hand one over. The rule under test: only a cleared background check
// (passed, or flagged-then-adjudicated cleared, and unexpired at the event)
// contributes a report; everyone else is listed on the cover with the reason.

const ADULT = '1983-02-10'
const MINOR = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)
const future = (years: number) => new Date(Date.now() + years * 365.25 * 86400000).toISOString()

const mentor = (over: Partial<EventMentor> = {}): EventMentor => ({
  participantId: 'p1',
  memberId: 'm1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  ...over,
})

function check(over: Partial<BackgroundCheck>): BackgroundCheck {
  return {
    id: 'c1',
    status: 'passed',
    result: 'clear',
    assessment: null,
    includes_canceled: false,
    provider_report_ref: 'rep_1',
    ordered_at: '2026-09-01T00:00:00Z',
    completed_at: '2026-09-02T00:00:00Z',
    expires_at: future(2),
    report_pdf_url: null,
    adjudicated_at: null,
    adjudication_outcome: null,
    adjudicated_label: null,
    adjudication_notes: null,
    provider_adjudication: null,
    ...over,
  }
}

function records(checks: BackgroundCheck[], extra: Partial<MemberComplianceRecords> = {}): MemberComplianceRecords {
  return { memberId: 'm1', email: 'ada@example.com', dateOfBirth: ADULT, license: null, checks, ...extra }
}

const verifiedLicense: TeacherLicense = {
  id: 'l1',
  license_number: '123',
  licensing_state: 'CO',
  expiry_date: '2030-01-01',
  verified_at: '2026-01-01T00:00:00Z',
  verified_label: 'Admin',
  document_path: null,
}

describe('classifyMentor', () => {
  it('a passed, unexpired check with a report ref is included', () => {
    const row = classifyMentor(mentor(), records([check({})]))
    expect(row).toMatchObject({ outcome: 'included', reportRef: 'rep_1', state: 'valid_bc' })
  })

  it('a flagged check adjudicated cleared is included', () => {
    const row = classifyMentor(
      mentor(),
      records([check({ status: 'referred', result: 'consider', adjudicated_at: '2026-09-03T00:00:00Z', adjudication_outcome: 'cleared' })]),
    )
    expect(row.outcome).toBe('included')
  })

  it('a flagged check nobody has adjudicated is not cleared', () => {
    const row = classifyMentor(mentor(), records([check({ status: 'referred', result: 'consider' })]))
    expect(row.outcome).toBe('not_cleared')
  })

  it('a flagged check adjudicated not cleared is not cleared', () => {
    const row = classifyMentor(
      mentor(),
      records([check({ status: 'referred', adjudicated_at: '2026-09-03T00:00:00Z', adjudication_outcome: 'not_cleared' })]),
    )
    expect(row.outcome).toBe('not_cleared')
  })

  it('a check that expires before the event date is not cleared', () => {
    const row = classifyMentor(mentor(), records([check({ expires_at: future(1) })]), future(2))
    expect(row.outcome).toBe('not_cleared')
  })

  it('the newest check decides: a re-order in progress supersedes an older pass', () => {
    const row = classifyMentor(
      mentor(),
      records([check({}), check({ id: 'c2', status: 'in_progress', ordered_at: '2026-09-20T00:00:00Z', provider_report_ref: null })]),
    )
    // deriveCompliance takes the newest check; in_progress is not cleared.
    expect(row.outcome).toBe('not_cleared')
  })

  it('cleared but no report ref on file is unavailable, not silently dropped', () => {
    expect(classifyMentor(mentor(), records([check({ provider_report_ref: null })])).outcome).toBe('unavailable')
  })

  it('a verified license with no check is listed as license-cleared', () => {
    const row = classifyMentor(mentor(), records([], { license: verifiedLicense }))
    expect(row).toMatchObject({ outcome: 'license', validUntil: '2030-01-01', reportRef: null })
  })

  it('a mentor under 18 is not required', () => {
    expect(classifyMentor(mentor(), records([], { dateOfBirth: MINOR })).outcome).toBe('not_required')
  })

  it('a registered email with no member row is flagged', () => {
    expect(classifyMentor(mentor({ memberId: null }), undefined)).toMatchObject({ outcome: 'no_account', memberId: null, dateOfBirth: null })
  })

  it('carries the member row\'s date of birth, whatever the outcome', () => {
    expect(classifyMentor(mentor(), records([check({})])).dateOfBirth).toBe(ADULT)
    expect(classifyMentor(mentor(), records([check({ status: 'referred' })])).dateOfBirth).toBe(ADULT)
  })
})

async function fakePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save()
}

function provider(fetchReportPdf: BackgroundProvider['fetchReportPdf']): BackgroundProvider {
  return {
    name: 'checkr',
    configured: () => true,
    order: async () => { throw new Error('not used') },
    verifyWebhook: () => true,
    parseWebhook: () => null,
    fetchStatus: async () => null,
    fetchReportPdf,
  }
}

const row = (over: Partial<MentorRow>): MentorRow => ({
  mentor: mentor(),
  memberId: 'm1',
  state: 'valid_bc',
  reportRef: 'rep_1',
  validUntil: future(2),
  dateOfBirth: ADULT,
  outcome: 'included',
  note: null,
  ...over,
})

describe('buildMentorReportPdf', () => {
  it('checkr mode: cover page, then each included report in order', async () => {
    const fetch = vi.fn(async (ref: string) => fakePdf(ref === 'rep_a' ? 2 : 3))
    const rows = [
      row({ reportRef: 'rep_a' }),
      row({ memberId: 'm2', outcome: 'license', reportRef: null, state: 'valid_license' }),
      row({ memberId: 'm3', reportRef: 'rep_b' }),
    ]
    const { pdf, rows: out } = await buildMentorReportPdf({ rows, mode: 'checkr', provider: provider(fetch), title: 'T', generatedBy: 'Admin' })
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(1 + 2 + 3)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(out.map((r) => r.outcome)).toEqual(['included', 'license', 'included'])
  })

  it('one failed fetch is named on the cover, not fatal to the export', async () => {
    const fetch = vi.fn(async (ref: string) => {
      if (ref === 'rep_bad') throw new Error('Checkr 500')
      if (ref === 'rep_none') throw new ReportPdfUnavailableError('no pdf')
      return fakePdf(1)
    })
    const rows = [row({ reportRef: 'rep_ok' }), row({ reportRef: 'rep_bad' }), row({ reportRef: 'rep_none' })]
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { pdf, rows: out } = await buildMentorReportPdf({ rows, mode: 'checkr', provider: provider(fetch), title: 'T', generatedBy: null })
    errSpy.mockRestore()
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2)
    expect(out.map((r) => r.outcome)).toEqual(['included', 'failed', 'unavailable'])
  })

  it('summary mode never calls Checkr', async () => {
    const fetch = vi.fn(async () => fakePdf(1))
    const { pdf } = await buildMentorReportPdf({ rows: [row({})], mode: 'summary', provider: provider(fetch), title: 'T', generatedBy: null })
    expect(fetch).not.toHaveBeenCalled()
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })

  it('bareSingle returns Checkr\'s PDF untouched', async () => {
    const bytes = await fakePdf(4)
    const { pdf } = await buildMentorReportPdf({ rows: [row({})], mode: 'checkr', provider: provider(async () => bytes), title: 'T', generatedBy: null, bareSingle: true })
    expect(pdf).toBe(bytes)
  })

  it('a long roster paginates the cover and still lists everyone', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ memberId: `m${i}`, outcome: 'not_cleared', reportRef: null }))
    const { pdf } = await buildMentorReportPdf({ rows, mode: 'summary', title: 'T', generatedBy: null })
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(coverPageCount(30))
    expect(coverPageCount(30)).toBe(3)
  })

  it('names Helvetica cannot encode do not break the export', async () => {
    const rows = [row({ mentor: mentor({ firstName: 'Zoë', lastName: '李' }), outcome: 'not_cleared', reportRef: null })]
    await expect(buildMentorReportPdf({ rows, mode: 'summary', title: 'Ünïcode — test', generatedBy: 'Łukasz' })).resolves.toBeTruthy()
  })
})

describe('logReportExport', () => {
  it('checkr mode logs only mentors whose report was attached', async () => {
    const { logActivity } = await import('@/lib/activity-log')
    vi.mocked(logActivity).mockClear()
    await logReportExport(
      {} as never,
      [row({ memberId: 'a' }), row({ memberId: 'b', outcome: 'failed' }), row({ memberId: null })],
      { mode: 'checkr', eventSlug: 'e', scope: 'event', actor: { actorType: 'admin' } },
    )
    expect(vi.mocked(logActivity).mock.calls.map((c) => c[0].memberId)).toEqual(['a'])
    expect(vi.mocked(logActivity).mock.calls[0][0].action).toBe('background_report_downloaded')
  })

  it('summary mode logs every listed member', async () => {
    const { logActivity } = await import('@/lib/activity-log')
    vi.mocked(logActivity).mockClear()
    await logReportExport({} as never, [row({ memberId: 'a' }), row({ memberId: 'b', outcome: 'not_cleared' })], {
      mode: 'summary',
      eventSlug: 'e',
      scope: 'event',
      actor: { actorType: 'member' },
    })
    expect(vi.mocked(logActivity)).toHaveBeenCalledTimes(2)
  })
})

describe('pdfSafe / fileSlug', () => {
  it('folds accents and replaces what WinAnsi cannot hold', () => {
    expect(pdfSafe('Zoë – “Ada”')).toBe('Zoe - "Ada"')
    expect(pdfSafe('李')).toBe('?')
  })
  it('makes a safe filename fragment', () => {
    expect(fileSlug('O\'Brien Zoë')).toBe('o-brien-zoe')
    expect(fileSlug('李')).toBe('mentor')
  })
})

describe('exportModeFor', () => {
  it('an admin gets Checkr reports by default, and the summary on request', () => {
    expect(exportModeFor(true, null)).toBe('checkr')
    expect(exportModeFor(true, 'summary')).toBe('summary')
    expect(exportModeFor(true, 'anything-else')).toBe('checkr')
  })
  it('an event manager always gets the summary, whatever they ask for', () => {
    expect(exportModeFor(false, null)).toBe('summary')
    expect(exportModeFor(false, 'checkr')).toBe('summary')
  })
})

describe('fittedFontSize', () => {
  it('a full 24-character Checkr report id fits the column at full size', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    // Report column: 792 - 48 - 568 = 176pt.
    expect(fittedFontSize(font, '4722c07dd9a10c3985ae432a', 10, 176)).toBe(10)
  })
  it('shrinks, rather than truncates, an unusually long one', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const long = 'x'.repeat(60)
    const size = fittedFontSize(font, long, 10, 176)
    expect(size).toBeLessThan(10)
    expect(font.widthOfTextAtSize(long, size) <= 176 || size === 6).toBe(true)
  })
})
