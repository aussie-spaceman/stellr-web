import { describe, it, expect } from 'vitest'
import { denverClock, isDigestSendTime } from './weekly-digest-schedule'

// vercel.json runs the job at 18:00 and 19:00 UTC on Fridays, and Hobby may
// fire anywhere within the hour. Exactly one of the two must send.
describe('isDigestSendTime', () => {
  it('sends from the 18:00 UTC run in summer (noon MDT), not the 19:00 one', () => {
    expect(isDigestSendTime(new Date('2026-10-30T18:47:00Z'))).toBe(true)
    expect(isDigestSendTime(new Date('2026-10-30T19:05:00Z'))).toBe(false)
  })

  it('sends from the 19:00 UTC run in winter (noon MST), not the 18:00 one', () => {
    expect(isDigestSendTime(new Date('2026-12-04T18:59:00Z'))).toBe(false)
    expect(isDigestSendTime(new Date('2026-12-04T19:01:00Z'))).toBe(true)
  })

  it('never sends on another day', () => {
    expect(isDigestSendTime(new Date('2026-10-29T18:30:00Z'))).toBe(false)
    expect(denverClock(new Date('2026-10-29T18:30:00Z'))).toEqual({ weekday: 'Thu', hour: 12 })
  })
})
