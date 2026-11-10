import { describe, expect, it } from 'vitest'
import {
  bannerNotice,
  buildGroupRows,
  checkInTime,
  openCheckInConfirm,
  codeFromScan,
  deskSearchMatches,
  flagsForStorage,
  groupMatchesFilter,
  groupMatchesSearch,
  meaningfulNote,
  parseCheckInCode,
  pendingFromQueue,
  queuedIds,
  staffKey,
  STAFF_KEY,
  type DeskGroup,
  type DeskParticipant,
} from './check-in-desk'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const REG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SIG = 'abcdefghijklmnopqrstuv'

const person = (over: Partial<DeskParticipant>): DeskParticipant => ({
  id: ID_A,
  registrationId: REG,
  firstName: 'Maya',
  lastName: 'Rivera',
  eventRole: 'participant',
  schoolName: 'Lincoln Middle School',
  shirtSize: 'M',
  checkedInAt: null,
  checkInMethod: null,
  company: null,
  merch: [],
  merchCollected: false,
  ...over,
})

describe('check-in codes as the desk reads them', () => {
  it('parses a participant or group code, case-insensitively for the kind and id', () => {
    expect(parseCheckInCode(`p.${ID_A}.${SIG}`)).toEqual({ kind: 'p', id: ID_A })
    expect(parseCheckInCode(`G.${REG.toUpperCase()}.${SIG}`)).toEqual({ kind: 'g', id: REG })
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'hello', `x.${ID_A}.${SIG}`, `p.${ID_A}.short`, `p.not-a-uuid.${SIG}`, null, undefined]) {
      expect(parseCheckInCode(bad)).toBeNull()
    }
  })

  it('reads the code out of the code page link a QR holds, or takes a bare code', () => {
    const code = `p.${ID_A}.${SIG}`
    expect(codeFromScan(`https://www.stellreducation.org/check-in/nevada/code?c=${encodeURIComponent(code)}`)).toBe(code)
    expect(codeFromScan(`  ${code}\n`)).toBe(code)
    expect(codeFromScan('https://www.stellreducation.org/check-in')).toBeNull()
    expect(codeFromScan('https://example.com/?c=nope')).toBeNull()
  })
})

describe('deskSearchMatches', () => {
  const group: DeskGroup = { id: REG, label: 'Lincoln MS', teacher: 'Dana Okafor' }

  it('matches the name, the school, or the group’s school and teacher, ignoring case and accents', () => {
    const p = person({ firstName: 'José', lastName: 'Núñez' })
    for (const q of ['jose', 'NUNEZ', 'josé n', 'lincoln middle', 'lincoln ms', 'okafor', '']) {
      expect(deskSearchMatches(p, q, group)).toBe(true)
    }
    expect(deskSearchMatches(p, 'okafor')).toBe(false)
    expect(deskSearchMatches(p, 'westside', group)).toBe(false)
  })
})

describe('buildGroupRows', () => {
  const groups: DeskGroup[] = [
    { id: 'g2', label: 'Westside High', teacher: 'A Teacher' },
    { id: 'g1', label: 'lincoln ms', teacher: 'B Teacher' },
    { id: 'g3', label: 'Empty Group', teacher: null },
  ]
  const people = [
    person({ id: 'p1', registrationId: 'g1', firstName: 'Zoe', checkedInAt: '2026-11-06T15:00:00Z' }),
    person({ id: 'p2', registrationId: 'g1', firstName: 'Amir' }),
    person({ id: 'p3', registrationId: 'g2', firstName: 'Kai', checkedInAt: '2026-11-06T15:01:00Z' }),
    person({ id: 'p4', registrationId: 'solo', firstName: 'Solo' }),
  ]

  it('lists groups A–Z by school, members by first name, and counts arrivals; empty groups drop out', () => {
    const rows = buildGroupRows(groups, people)
    expect(rows.map((r) => r.group.id)).toEqual(['g1', 'g2'])
    expect(rows[0].members.map((m) => m.firstName)).toEqual(['Amir', 'Zoe'])
    expect([rows[0].arrived, rows[0].total]).toEqual([1, 2])
    expect([rows[1].arrived, rows[1].total]).toEqual([1, 1])
  })

  it('filters by arrival and searches members, school and teacher', () => {
    const [lincoln, westside] = buildGroupRows(groups, people)
    expect(groupMatchesFilter(lincoln, 'waiting')).toBe(true)
    expect(groupMatchesFilter(lincoln, 'arrived')).toBe(false)
    expect(groupMatchesFilter(westside, 'arrived')).toBe(true)
    expect(groupMatchesSearch(lincoln, 'amir')).toBe(true)
    expect(groupMatchesSearch(lincoln, 'b teacher')).toBe(true)
    expect(groupMatchesSearch(lincoln, 'kai')).toBe(false)
  })
})

describe('meaningfulNote', () => {
  it('keeps a real note and drops the ways people write "none"', () => {
    expect(meaningfulNote('Peanut allergy (EpiPen in bag)')).toBe('Peanut allergy (EpiPen in bag)')
    for (const none of [null, undefined, '', '  ', 'None', 'none.', 'N/A', 'na', 'No', 'nil', '-']) {
      expect(meaningfulNote(none)).toBeNull()
    }
  })
})

describe('checkInTime', () => {
  const now = new Date('2026-11-06T16:00:00Z')

  it('keeps the time a queued tap was made', () => {
    expect(checkInTime('2026-11-06T15:12:00.000Z', now)).toBe('2026-11-06T15:12:00.000Z')
  })

  it('uses now for a missing, garbled, future or day-old time', () => {
    for (const bad of [undefined, null, 42, 'yesterday', '2026-11-06T17:00:00Z', '2026-11-05T15:00:00Z']) {
      expect(checkInTime(bad, now)).toBe(now.toISOString())
    }
  })

  it('pulls a slightly fast desk clock back to now', () => {
    expect(checkInTime('2026-11-06T16:01:00Z', now)).toBe(now.toISOString())
  })
})

describe('the queue kept on the device', () => {
  it('knows who each queued tap is for, including a scanned participant code', () => {
    expect(queuedIds({ action: 'manual', participantId: ID_A, label: 'x' })).toEqual([ID_A])
    expect(queuedIds({ action: 'group_check_in', participantIds: [ID_A, ID_B], label: 'x' })).toEqual([ID_A, ID_B])
    expect(queuedIds({ action: 'scan', code: `p.${ID_B}.${SIG}`, label: 'x' })).toEqual([ID_B])
    expect(queuedIds({ action: 'scan', code: `g.${REG}.${SIG}`, label: 'x' })).toEqual([])
  })

  it('rebuilds what the rows should show, later taps winning', () => {
    const pending = pendingFromQueue([
      { action: 'group_check_in', participantIds: [ID_A, ID_B], at: '2026-11-06T15:00:00Z', label: 'Lincoln' },
      { action: 'undo', participantId: ID_B, label: 'B' },
      { action: 'merch_collected', participantId: ID_A, label: 'A' },
    ])
    expect(pending[ID_A]).toEqual({ checkedInAt: '2026-11-06T15:00:00Z', checkInMethod: 'manual', merchCollected: true })
    expect(pending[ID_B]).toEqual({ checkedInAt: null, checkInMethod: null })
  })

  it('queues a mentor or event manager by their staff key, so an offline tap survives a reload', () => {
    expect(queuedIds({ action: 'staff_check_in', staffKey: 'm.user_em', label: 'Em' })).toEqual(['m.user_em'])
    const pending = pendingFromQueue([
      { action: 'staff_check_in', staffKey: `v.${ID_A}`, at: '2026-11-06T15:00:00Z', label: 'V' },
      { action: 'staff_check_in', staffKey: 'm.user_em', at: '2026-11-06T15:01:00Z', label: 'Em' },
      { action: 'staff_undo', staffKey: 'm.user_em', label: 'Em' },
    ])
    expect(pending[`v.${ID_A}`]).toEqual({ checkedInAt: '2026-11-06T15:00:00Z', checkInMethod: 'manual' })
    expect(pending['m.user_em']).toEqual({ checkedInAt: null, checkInMethod: null })
  })

  it('names staff the way the server checks them', () => {
    expect(staffKey('volunteer', ID_A)).toBe(`v.${ID_A}`)
    expect(staffKey('event_manager', 'user_2abcDEF')).toBe('m.user_2abcDEF')
    expect(STAFF_KEY.test(staffKey('event_manager', 'user_2abcDEF'))).toBe(true)
    expect(STAFF_KEY.test('m.user_x; drop')).toBe(false)
  })

  it('keeps medical and dietary text off the device', () => {
    const stored = flagsForStorage({
      flags: { [ID_A]: { agreement: 'Not Issued', agreementDetail: null, unpaid: null, medical: 'Asthma', dietary: ['Vegan'] } },
      contacts: {},
    })
    expect(stored.flags[ID_A]).toEqual({ agreement: 'Not Issued', agreementDetail: null, unpaid: null, medical: 'See the roster', dietary: ['See the roster'] })
  })
})

// S0 (Nov 2026): an event manager's open closes only their own events, so an
// event they don't run can keep the banner. The desk must not promise the
// banner moves here, and must say when it points elsewhere.
describe('the banner, as the desk describes it', () => {
  it('the open confirm names what will close, and promises nothing about the banner', () => {
    expect(openCheckInConfirm([])).toBeNull()
    expect(openCheckInConfirm([{ title: 'Utah SDC' }])).toBe('Check-in is open for Utah SDC. Opening this one closes it.')
    expect(openCheckInConfirm([{ title: 'Utah SDC' }, { title: 'Iowa SDC' }])).toBe(
      'Check-in is open for Utah SDC, Iowa SDC. Opening this one closes them.',
    )
    expect(openCheckInConfirm([{ title: 'Utah SDC' }])).not.toMatch(/banner/)
  })

  it('says when the banner points here', () => {
    expect(bannerNotice({ checkInOpen: true, bannerTarget: true, isVirtual: false })).toEqual({
      tone: 'here',
      text: 'The check-in banner points here.',
    })
  })

  it('says when check-in is open here but the banner points to another event', () => {
    const n = bannerNotice({ checkInOpen: true, bannerTarget: false, isVirtual: false })
    expect(n?.tone).toBe('elsewhere')
    expect(n?.text).toMatch(/points to another event right now/)
  })

  it('says nothing when it cannot know, when check-in is closed, or for a virtual event', () => {
    expect(bannerNotice({ checkInOpen: true, bannerTarget: null, isVirtual: false })).toBeNull()
    expect(bannerNotice({ checkInOpen: false, bannerTarget: false, isVirtual: false })).toBeNull()
    expect(bannerNotice({ checkInOpen: true, bannerTarget: false, isVirtual: true })).toBeNull()
  })
})
