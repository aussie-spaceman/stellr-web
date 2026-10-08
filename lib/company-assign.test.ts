import { describe, expect, it } from 'vitest'
import { assignCompanies, chunkSizes, suggestCompanies, type AssignableStudent } from './company-assign'

function student(id: string, over: Partial<AssignableStudent> = {}): AssignableStudent {
  return { participantId: id, groupKey: null, gender: null, age: null, experience: 0, ...over }
}

function companiesOf(result: Map<string, number>, ids: string[]) {
  return new Set(ids.map((id) => result.get(id)))
}

function sizes(result: Map<string, number>, count: number) {
  const s = Array(count).fill(0)
  for (const c of result.values()) s[c - 1]++
  return s
}

describe('chunkSizes', () => {
  it('keeps a group of up to six whole', () => {
    for (let n = 1; n <= 6; n++) expect(chunkSizes(n)).toEqual([n])
  })

  it('splits larger groups evenly with no chunk under three', () => {
    expect(chunkSizes(7)).toEqual([4, 3])
    expect(chunkSizes(8)).toEqual([4, 4])
    expect(chunkSizes(12)).toEqual([6, 6])
    expect(chunkSizes(13)).toEqual([5, 4, 4])
    for (let n = 7; n <= 60; n++) {
      const s = chunkSizes(n)
      expect(s.reduce((a, b) => a + b, 0)).toBe(n)
      expect(Math.min(...s)).toBeGreaterThanOrEqual(3)
      expect(Math.max(...s)).toBeLessThanOrEqual(6)
    }
  })
})

describe('assignCompanies', () => {
  it('keeps a group of six in one company', () => {
    const group = Array.from({ length: 6 }, (_, i) => student(`g${i}`, { groupKey: 'reg-a', school: 'a' }))
    const others = Array.from({ length: 12 }, (_, i) => student(`i${i}`, { school: `s${i}` }))
    const result = assignCompanies([...group, ...others], 3)
    expect(companiesOf(result, group.map((s) => s.participantId)).size).toBe(1)
  })

  it('splits a group of eight into two chunks of four', () => {
    const group = Array.from({ length: 8 }, (_, i) => student(`g${i}`, { groupKey: 'reg-a', school: 'a' }))
    const others = Array.from({ length: 16 }, (_, i) => student(`i${i}`, { school: `s${i}` }))
    const result = assignCompanies([...group, ...others], 4)
    const counts = new Map<number, number>()
    for (const s of group) counts.set(result.get(s.participantId)!, (counts.get(result.get(s.participantId)!) ?? 0) + 1)
    expect([...counts.values()].sort()).toEqual([4, 4])
  })

  it('keeps companies within one student of each other in size', () => {
    const students = Array.from({ length: 23 }, (_, i) => student(`s${i}`, { age: 13 + (i % 5), gender: i % 2 ? 'Male' : 'Female' }))
    const s = sizes(assignCompanies(students, 4), 4)
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1)
  })

  it('balances age before gender', () => {
    // 8 students: four 13-year-olds and four 17-year-olds. Ages split evenly
    // across two companies means each company averages 15.
    const students = [
      ...Array.from({ length: 4 }, (_, i) => student(`y${i}`, { age: 13, gender: 'Female' })),
      ...Array.from({ length: 4 }, (_, i) => student(`o${i}`, { age: 17, gender: 'Male' })),
    ]
    const result = assignCompanies(students, 2)
    const young = students.filter((s) => s.age === 13).map((s) => result.get(s.participantId))
    expect(young.filter((c) => c === 1).length).toBe(2)
    expect(young.filter((c) => c === 2).length).toBe(2)
  })

  it('spreads a school across companies', () => {
    const students = [
      ...Array.from({ length: 4 }, (_, i) => student(`a${i}`, { school: 'lincoln' })),
      ...Array.from({ length: 4 }, (_, i) => student(`b${i}`, { school: 'jefferson' })),
    ]
    const result = assignCompanies(students, 2)
    const lincoln = students.filter((s) => s.school === 'lincoln').map((s) => result.get(s.participantId))
    expect(lincoln.filter((c) => c === 1).length).toBe(2)
  })

  it('spreads experienced students and leaders', () => {
    const students = Array.from({ length: 12 }, (_, i) =>
      student(`s${i}`, { experience: i < 3 ? 3 : 0, leader: i >= 9 ? 1 : 0 }),
    )
    const result = assignCompanies(students, 3)
    expect(companiesOf(result, ['s0', 's1', 's2']).size).toBe(3)
    expect(companiesOf(result, ['s9', 's10', 's11']).size).toBe(3)
  })

  it('spreads skills so each company has a strength in each area', () => {
    // Three kinds of student, four of each; three companies.
    const kinds = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    const students = Array.from({ length: 12 }, (_, i) => student(`s${i}`, { skills: kinds[i % 3] }))
    const result = assignCompanies(students, 3)
    for (let c = 1; c <= 3; c++) {
      const inC = students.filter((s) => result.get(s.participantId) === c)
      const covered = new Set(inC.map((s) => s.skills!.indexOf(1)))
      expect(covered.size).toBe(3)
    }
  })

  it('leaves hand-placed students where they are', () => {
    const students = Array.from({ length: 9 }, (_, i) => student(`s${i}`, { age: 14 }))
    students[0].lockedCompany = 3
    students[1].lockedCompany = 3
    const result = assignCompanies(students, 3)
    expect(result.get('s0')).toBe(3)
    expect(result.get('s1')).toBe(3)
  })

  it('puts requested teammates together', () => {
    const students = Array.from({ length: 12 }, (_, i) => student(`s${i}`, { age: 13 + (i % 4) }))
    students[0].teammateIds = ['s7']
    students[3].teammateIds = ['s4', 's11']
    const result = assignCompanies(students, 3)
    expect(result.get('s0')).toBe(result.get('s7'))
    expect(companiesOf(result, ['s3', 's4', 's11']).size).toBe(1)
  })

  it('does not let teammate requests grow a unit past six', () => {
    const group = Array.from({ length: 6 }, (_, i) => student(`g${i}`, { groupKey: 'reg-a' }))
    const friend = student('f', { teammateIds: ['g0'] })
    const others = Array.from({ length: 11 }, (_, i) => student(`i${i}`))
    const result = assignCompanies([...group, friend, ...others], 3)
    // The group stays whole; the friend may or may not join, but sizes stay even.
    expect(companiesOf(result, group.map((s) => s.participantId)).size).toBe(1)
    const s = sizes(result, 3)
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1)
  })

  it('is deterministic', () => {
    const students = Array.from({ length: 30 }, (_, i) =>
      student(`s${i}`, { age: 12 + (i % 6), gender: ['Male', 'Female', 'Non-binary'][i % 3], experience: i % 4, school: `sch${i % 5}` }),
    )
    expect([...assignCompanies(students, 5)]).toEqual([...assignCompanies(students, 5)])
  })

  it('handles 100 students across 10 companies quickly', () => {
    const students = Array.from({ length: 100 }, (_, i) =>
      student(`s${i}`, {
        groupKey: i < 40 ? `reg-${Math.floor(i / 8)}` : null,
        school: `sch${i % 12}`,
        age: 12 + (i % 7),
        gender: i % 2 ? 'Male' : 'Female',
        experience: i % 3,
        skills: Array.from({ length: 26 }, (_, d) => ((i * 7 + d) % 5) / 4),
        leader: (i % 4) / 3,
        ethnicity: [['a'], ['b'], ['a', 'c']][i % 3],
      }),
    )
    const t0 = Date.now()
    const result = assignCompanies(students, 10)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(result.size).toBe(100)
    const s = sizes(result, 10)
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(2)
  })
})

describe('suggestCompanies', () => {
  it('suggests the company that needs the student most, without moving anyone', () => {
    const placed = [
      ...Array.from({ length: 4 }, (_, i) => ({ ...student(`a${i}`, { age: 13 }), company: 1 })),
      ...Array.from({ length: 3 }, (_, i) => ({ ...student(`b${i}`, { age: 13 }), company: 2 })),
    ]
    const late = student('late', { age: 13 })
    expect(suggestCompanies(placed, [late], 2).get('late')).toBe(2)
  })

  it('suggests a late student joins their group', () => {
    const placed = [
      ...Array.from({ length: 3 }, (_, i) => ({ ...student(`a${i}`, { groupKey: 'reg-x' }), company: 1 })),
      ...Array.from({ length: 4 }, (_, i) => ({ ...student(`b${i}`), company: 2 })),
    ]
    const late = student('late', { groupKey: 'reg-x' })
    expect(suggestCompanies(placed, [late], 2).get('late')).toBe(1)
  })
})
