import { describe, it, expect, vi } from 'vitest'

// lib/hubspot pulls in the mail and Supabase clients for its dead-letter path;
// neither is exercised here, but both throw at import time without env.
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }) }))

const { appendLogEntry, logLine } = await import('./hubspot')

/**
 * The activity log is the fix for the failure that started this work: five
 * lead routes all wrote into HubSpot's shared free-text `message` property, so
 * whichever fired last erased the rest. A contact who asked about Nevada and
 * later downloaded a white paper kept only the white paper, and the notify-me
 * list quietly lost them. Appending is the whole point — these tests exist to
 * stop anyone reintroducing an overwrite.
 */
describe('appendLogEntry', () => {
  it('starts a log when the contact has none', () => {
    expect(appendLogEntry(undefined, 'entry one')).toBe('entry one')
    expect(appendLogEntry('', 'entry one')).toBe('entry one')
  })

  it('preserves earlier entries instead of overwriting them', () => {
    const first = appendLogEntry(undefined, '2026-08-10 · Event Notify · nevada-2026')
    const second = appendLogEntry(first, '2026-09-02 · White Paper · STEM Power Skills')

    expect(second.split('\n')).toEqual([
      '2026-08-10 · Event Notify · nevada-2026',
      '2026-09-02 · White Paper · STEM Power Skills',
    ])
  })

  it('keeps entries in chronological order, newest last', () => {
    let log = ''
    for (const entry of ['a', 'b', 'c']) log = appendLogEntry(log, entry)
    expect(log).toBe('a\nb\nc')
  })

  it('drops blank and whitespace-only lines picked up from existing values', () => {
    expect(appendLogEntry('a\n\n   \nb', 'c')).toBe('a\nb\nc')
  })

  it('bounds the log so a repeat visitor cannot overflow the property', () => {
    let log = ''
    for (let i = 0; i < 80; i++) log = appendLogEntry(log, `entry ${i}`)

    const lines = log.split('\n')
    expect(lines).toHaveLength(50)
    // Oldest are trimmed, the most recent survive.
    expect(lines[0]).toBe('entry 30')
    expect(lines.at(-1)).toBe('entry 79')
  })
})

describe('logLine', () => {
  it('formats as date · source · detail so entries sort and grep cleanly', () => {
    const line = logLine('event_notify', 'nevada-space-design-challenge-2026 · Individual')
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2} · Event Notify · nevada-space-design-challenge-2026 · Individual$/,
    )
  })

  it('uses the human-readable source label, not the internal key', () => {
    expect(logLine('white_paper', 'x')).toContain('· White Paper ·')
    expect(logLine('host_event', 'x')).toContain('· Host An Event ·')
  })
})
