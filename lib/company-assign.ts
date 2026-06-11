// Automatic Company assignment for event students (PRD 6.7).
// Priorities, in order:
//   1. Students registered in the same Group stay in as few Companies as possible
//   2. Even gender distribution
//   3. Similar average age per Company
//   4. Similar average prior-event experience per Company

export interface AssignableStudent {
  participantId: string
  /** registration id for group registrations, null for individual registrants */
  groupKey: string | null
  gender: string | null
  /** age in years (fractional ok) */
  age: number | null
  /** number of prior event participations */
  experience: number
}

interface CompanyState {
  number: number
  members: AssignableStudent[]
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

// Cost of placing `student` into `company`: weighted gender/age/experience
// imbalance relative to the overall population. Lower is better.
function placementCost(
  company: CompanyState,
  student: AssignableStudent,
  overallAvgAge: number,
  overallAvgExp: number
): number {
  let cost = 0

  if (student.gender) {
    const sameGender = company.members.filter((m) => m.gender === student.gender).length
    const ratioAfter = (sameGender + 1) / (company.members.length + 1)
    cost += ratioAfter // prefer companies with fewer of this gender
  }

  if (student.age !== null) {
    const ages = company.members.map((m) => m.age).filter((a): a is number => a !== null)
    const avgAfter = avg([...ages, student.age])
    cost += Math.abs(avgAfter - overallAvgAge) / 10 // ~0..0.4 for school ages
  }

  const exps = company.members.map((m) => m.experience)
  const expAfter = avg([...exps, student.experience])
  cost += Math.abs(expAfter - overallAvgExp) / 5

  return cost
}

/**
 * Returns participantId → company number (1..companyCount).
 * Deterministic for a given input order.
 */
export function assignCompanies(
  students: AssignableStudent[],
  companyCount: number
): Map<string, number> {
  const count = Math.max(1, Math.min(10, companyCount))
  const companies: CompanyState[] = Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    members: [],
  }))

  const overallAvgAge = avg(students.map((s) => s.age).filter((a): a is number => a !== null))
  const overallAvgExp = avg(students.map((s) => s.experience))
  // No company should exceed this, so large groups get split into chunks
  const maxSize = Math.ceil(students.length / count)

  // Group students by registration; individuals are singleton "groups"
  const byGroup = new Map<string, AssignableStudent[]>()
  const individuals: AssignableStudent[] = []
  for (const s of students) {
    if (s.groupKey) {
      const list = byGroup.get(s.groupKey) ?? []
      list.push(s)
      byGroup.set(s.groupKey, list)
    } else {
      individuals.push(s)
    }
  }

  // Split each group into the fewest chunks that fit under maxSize
  const chunks: AssignableStudent[][] = []
  for (const groupStudents of byGroup.values()) {
    const parts = Math.max(1, Math.ceil(groupStudents.length / maxSize))
    const per = Math.ceil(groupStudents.length / parts)
    for (let i = 0; i < groupStudents.length; i += per) {
      chunks.push(groupStudents.slice(i, i + per))
    }
  }

  // Largest chunks first into the currently-smallest company
  chunks.sort((a, b) => b.length - a.length)
  for (const chunk of chunks) {
    const target = [...companies].sort(
      (a, b) => a.members.length - b.members.length || a.number - b.number
    )[0]
    target.members.push(...chunk)
  }

  // Individuals: among the smallest companies, pick the best-balancing one.
  // Most experienced first so experience spreads before companies fill up.
  individuals.sort((a, b) => b.experience - a.experience)
  for (const student of individuals) {
    const minSize = Math.min(...companies.map((c) => c.members.length))
    const candidates = companies.filter((c) => c.members.length <= minSize + 1)
    let best = candidates[0]
    let bestCost = Infinity
    for (const c of candidates) {
      const cost =
        placementCost(c, student, overallAvgAge, overallAvgExp) +
        (c.members.length - minSize) * 0.5 // mild pressure toward smaller companies
      if (cost < bestCost) {
        bestCost = cost
        best = c
      }
    }
    best.members.push(student)
  }

  const result = new Map<string, number>()
  for (const c of companies) {
    for (const m of c.members) result.set(m.participantId, c.number)
  }
  return result
}
