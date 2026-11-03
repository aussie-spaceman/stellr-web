import { describe, it, expect, vi, beforeEach } from 'vitest'

// S0 content safety: every registrant (minors included) receives an event
// email attachment under the name and type stored here, so the route derives
// the type from the sniffed bytes and needs a name that matches them. What the
// browser posts as contentType is ignored. claimUpload itself (the byte checks)
// is covered in lib/uploads.test.ts; here it reports a format.

const { claimUpload, discardUpload, getEventEmail, update, held } = vi.hoisted(() => ({
  claimUpload: vi.fn(),
  discardUpload: vi.fn(),
  getEventEmail: vi.fn(),
  update: vi.fn(),
  // The event's emails and their attachments, as the holder check reads them.
  held: { rows: [] as { id: string; attachments: { path: string }[] }[], error: null as { message: string } | null },
}))

vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true }) }))
vi.mock('@/lib/uploads', () => ({ claimUpload, discardUpload }))
vi.mock('@/lib/event-emails/store', () => ({ EDITABLE: ['draft', 'scheduled'], getEventEmail }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => ({
      select: () => ({
        eq: async (column: string, slug: string) =>
          column === 'event_slug' && slug === 'nevada' ? { data: held.rows, error: held.error } : { data: [], error: null },
      }),
      update: (row: Record<string, unknown>) => {
        update(row)
        const chain = { eq: () => chain, in: () => chain, select: () => chain, maybeSingle: async () => ({ data: { id: 'e1', ...row }, error: null }) }
        return chain
      },
    }),
  }),
}))

import { POST } from './route'

const PATH = 'event-email/nevada/1-file'

const attach = (body: Record<string, unknown>) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ storagePath: PATH, ...body }) }), {
    params: Promise.resolve({ slug: 'nevada', id: 'e1' }),
  })

const claimedAs = (format: string) =>
  claimUpload.mockResolvedValue({ bytes: new Uint8Array(10), bucket: 'community-resources', format })

beforeEach(() => {
  vi.clearAllMocks()
  held.rows = [{ id: 'e1', attachments: [] }]
  held.error = null
  getEventEmail.mockResolvedValue({ id: 'e1', status: 'draft', attachments: [] })
})

// A refusal deletes the object it was given. Event-email paths are not tied to
// one email, so a path another email already holds must be turned away before
// anything claims — or deletes — it.
describe('POST event email attachments — a file another email holds', () => {
  const schedule = { path: PATH, filename: 'Schedule.pdf', size: 10, contentType: 'application/pdf' }

  it('refuses, untouched, a path attached to another email, whatever name is posted', async () => {
    held.rows = [{ id: 'e1', attachments: [] }, { id: 'e2', attachments: [schedule] }]
    claimedAs('pdf')
    for (const filename of ['schedule.html', 'Schedule.docx', 'Schedule.pdf']) {
      const res = await attach({ filename })
      expect(res.status).toBe(409)
    }
    expect(claimUpload).not.toHaveBeenCalled()
    expect(discardUpload).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses a path this email already holds, and one a sent email holds', async () => {
    held.rows = [{ id: 'e1', attachments: [schedule] }]
    expect((await attach({ filename: 'Schedule.pdf' })).status).toBe(409)
    held.rows = [{ id: 'e1', attachments: [] }, { id: 'sent-1', attachments: [schedule] }]
    expect((await attach({ filename: 'notes.html' })).status).toBe(409)
    expect(claimUpload).not.toHaveBeenCalled()
    expect(discardUpload).not.toHaveBeenCalled()
  })

  // The holder check compares strings, but storage resolves `./`, `%2e/`, a
  // trailing `?…` and the like before it reads, so each of these is the held
  // file under another name: attached, it would be one object on two emails.
  it.each([
    'event-email/nevada/./1-file',
    'event-email/nevada/%2e/1-file',
    'event-email/nevada/1-file?x',
    'event-email/nevada/1-file#x',
    'event-email/nevada/1-file ',
    'event-email/nevada/%2e%2e/carson/1-file',
  ])('refuses, untouched, %j: another name for a held or foreign path', async (storagePath) => {
    held.rows = [{ id: 'e1', attachments: [] }, { id: 'e2', attachments: [schedule] }]
    claimedAs('pdf')
    const res = await attach({ storagePath, filename: 'Schedule.pdf' })
    expect(res.status).toBe(400)
    expect(claimUpload).not.toHaveBeenCalled()
    expect(discardUpload).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('touches nothing when it cannot tell who holds the file', async () => {
    held.error = { message: 'timeout' }
    expect((await attach({ filename: 'schedule.html' })).status).toBe(500)
    expect(claimUpload).not.toHaveBeenCalled()
    expect(discardUpload).not.toHaveBeenCalled()
  })

  it('still attaches, and still drops on refusal, a file no email holds', async () => {
    held.rows = [{ id: 'e1', attachments: [] }, { id: 'e2', attachments: [{ ...schedule, path: 'event-email/nevada/2-other' }] }]
    claimedAs('pdf')
    expect((await attach({ filename: 'Schedule.pdf' })).status).toBe(200)
    expect((await attach({ filename: 'schedule.html' })).status).toBe(415)
    expect(discardUpload).toHaveBeenCalledWith('community-resources', PATH)
  })
})

describe('POST event email attachments', () => {
  it('refuses a CSV posted as schedule.html / text/html, and drops the object', async () => {
    claimedAs('text')
    const res = await attach({ filename: 'schedule.html', contentType: 'text/html' })
    expect(res.status).toBe(415)
    expect(discardUpload).toHaveBeenCalledWith('community-resources', PATH)
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['map.svg', 'tool.jar', 'setup.exe', 'schedule.pdf.html', 'schedule.html.'])(
    'refuses and drops a real PDF posted as %j',
    async (filename) => {
      claimedAs('pdf')
      const res = await attach({ filename, contentType: 'application/pdf' })
      expect(res.status).toBe(415)
      expect(discardUpload).toHaveBeenCalledWith('community-resources', PATH)
      expect(update).not.toHaveBeenCalled()
    },
  )

  it('refuses a name that claims another format, or none', async () => {
    claimedAs('pdf')
    expect((await attach({ filename: 'Schedule.docx' })).status).toBe(415)
    expect((await attach({ filename: 'Schedule' })).status).toBe(415)
    expect(update).not.toHaveBeenCalled()
  })

  // The name was cut to 200 characters before its extension was read, so a
  // 230-character `….pdf` (signing takes up to 255) lost its `.pdf`, was refused
  // as having no extension, and its object was deleted.
  it('takes a 230-character name, and keeps its extension when it shortens it', async () => {
    claimedAs('pdf')
    const filename = `${'x'.repeat(226)}.pdf`
    expect(filename).toHaveLength(230)
    expect((await attach({ filename })).status).toBe(200)
    expect(discardUpload).not.toHaveBeenCalled()
    expect(update.mock.calls[0][0].attachments[0]).toMatchObject({
      filename: `${'x'.repeat(196)}.pdf`,
      contentType: 'application/pdf',
    })
  })

  it('still refuses a long name whose extension is wrong, judging the whole name', async () => {
    claimedAs('pdf')
    // Cut at 200, this would have read as `….pdf`.
    expect((await attach({ filename: `${'x'.repeat(196)}.pdf${'y'.repeat(30)}.html` })).status).toBe(415)
    expect((await attach({ filename: `${'x'.repeat(226)}.docx` })).status).toBe(415)
    expect(discardUpload).toHaveBeenCalledTimes(2)
    expect(update).not.toHaveBeenCalled()
  })

  it("passes on claimUpload's refusal of bytes that are not an accepted format", async () => {
    claimUpload.mockResolvedValue({ error: 'That file doesn’t look like a PDF, Office, OpenDocument, Keynote, image, CSV or calendar file.', status: 415 })
    const res = await attach({ filename: 'schedule.pdf', contentType: 'application/pdf' })
    expect(res.status).toBe(415)
    expect(update).not.toHaveBeenCalled()
  })

  it('stores the type the bytes are, not the posted one', async () => {
    claimedAs('text')
    const res = await attach({ filename: 'Teams.csv', contentType: 'text/html' })
    expect(res.status).toBe(200)
    expect(claimUpload).toHaveBeenCalledWith({ purpose: 'event-email-attachment', storagePath: PATH })
    expect(update).toHaveBeenCalledWith({
      attachments: [{ path: PATH, filename: 'Teams.csv', size: 10, contentType: 'text/csv' }],
    })
  })

  it.each(['text/html', 'image/svg+xml', 'application/xhtml+xml; charset=utf-8'])(
    'ignores a posted %s for a real PDF',
    async (contentType) => {
      claimedAs('pdf')
      expect((await attach({ filename: 'Nevada schedule.pdf', contentType })).status).toBe(200)
      expect(update.mock.calls[0][0].attachments[0].contentType).toBe('application/pdf')
    },
  )

  it('sends Nevada’s documents under their real types', async () => {
    claimedAs('ooxml')
    await attach({ filename: 'Parent packet.docx', contentType: '' })
    expect(update.mock.calls[0][0].attachments[0].contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    claimedAs('pdf')
    await attach({ filename: 'Schedule.PDF', contentType: 'application/octet-stream' })
    expect(update.mock.calls[1][0].attachments[0].contentType).toBe('application/pdf')
    claimedAs('calendar')
    await attach({ filename: 'Check-in.ics', contentType: 'text/plain' })
    expect(update.mock.calls[2][0].attachments[0].contentType).toBe('text/calendar')
  })
})
