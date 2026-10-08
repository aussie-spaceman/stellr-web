// Automatic Company assignment for event students (PRD 6.7, reworked 7 Oct 2026
// for team profiles).
//
// Hard rules, applied before any balancing:
//   1. A group registration of up to 6 students stays together. A larger group
//      is split into the fewest chunks of at most 6, sized as evenly as
//      possible, so no chunk has fewer than 3 (7 → 4+3, 8 → 4+4, 13 → 5+4+4).
//   2. Students placed by hand (`lockedCompany`) stay where they are.
//   3. Teammate requests join two units when the result is still 6 or fewer.
//
// Then companies are balanced, in David's priority order:
//   age/grade > school mix > experience > skill spread > gender > leadership > ethnicity
//
// Each factor is scored as the share of its variance that lies BETWEEN
// companies (eta squared: 0 = every company looks like the whole cohort, 1 =
// companies completely different). That puts age in years, a school name and
// a set of skills on one 0..1 scale, so the weights mean what they say.
// Company sizes are kept even, and a unit is drawn towards a company holding
// its hand-placed groupmates or requested teammates.
//
// Greedy placement (largest units first) then local search (moves and equal-
// size swaps) until nothing improves. Deterministic for a given input order.

export interface AssignableStudent {
  participantId: string
  /** registration id for group registrations, null for individual registrants */
  groupKey: string | null
  /** Normalised school name, for school mix; null when unknown. */
  school?: string | null
  gender: string | null
  /** age in years (fractional ok) */
  age: number | null
  /** number of prior Stellr events */
  experience: number
  ethnicity?: string[]
  /** Team-profile skill vector (lib/team-profile/vectors.ts); null when not answered. */
  skills?: number[] | null
  /** 0..1 appetite and ability to lead; null when not answered. */
  leader?: number | null
  /** participantIds this student asked to be with (already matched to the roster). */
  teammateIds?: string[]
  /** Company number this student was placed in by hand; they are not moved. */
  lockedCompany?: number | null
}

export const MAX_UNIT = 6
const MIN_CHUNK = 3

/** Weights in David's priority order (7 Oct 2026). */
export const FACTOR_WEIGHTS = {
  age: 7,
  school: 6,
  experience: 5,
  skills: 4,
  gender: 3,
  leadership: 2,
  ethnicity: 1,
} as const

const SIZE_WEIGHT = 3 // per (students away from an even share)²
const AFFINITY = 5 // per hand-placed groupmate or requested teammate already in the company

/** Splits n students into chunk sizes per rule 1. */
export function chunkSizes(n: number): number[] {
  if (n <= MAX_UNIT) return [n]
  const k = Math.ceil(n / MAX_UNIT)
  const base = Math.floor(n / k)
  const extra = n % k
  const sizes = Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0))
  // n > 6 and k = ceil(n/6) guarantee base >= 3; asserted so a rule change can't slip.
  if (sizes.some((s) => s < MIN_CHUNK)) throw new Error(`chunkSizes(${n}) produced a chunk under ${MIN_CHUNK}`)
  return sizes
}

// ── Factor vectors ────────────────────────────────────────────────────────────

interface Metric {
  weight: number
  dim: number
  /** Per student index; null = not known, left out of this factor. */
  vec: (Float64Array | null)[]
  totalSS: number
}

function oneHot(values: (string | null | undefined)[]): (Float64Array | null)[] {
  const cats = [...new Set(values.filter((v): v is string => !!v))].sort()
  const idx = new Map(cats.map((c, i) => [c, i]))
  return values.map((v) => {
    if (!v) return null
    const a = new Float64Array(cats.length)
    a[idx.get(v)!] = 1
    return a
  })
}

function multiHot(values: (string[] | undefined)[]): (Float64Array | null)[] {
  const cats = [...new Set(values.flatMap((v) => v ?? []))].sort()
  const idx = new Map(cats.map((c, i) => [c, i]))
  return values.map((v) => {
    if (!v || v.length === 0) return null
    const a = new Float64Array(cats.length)
    for (const c of v) a[idx.get(c)!] = 1 / v.length
    return a
  })
}

const scalar = (values: (number | null | undefined)[]) =>
  values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Float64Array.of(v) : null))

function metric(weight: number, vec: (Float64Array | null)[]): Metric | null {
  const present = vec.filter((v): v is Float64Array => !!v)
  if (present.length < 2) return null
  const dim = present[0].length
  if (dim === 0 || present.some((v) => v.length !== dim)) return null
  const mean = new Float64Array(dim)
  for (const v of present) for (let d = 0; d < dim; d++) mean[d] += v[d] / present.length
  let totalSS = 0
  for (const v of present) for (let d = 0; d < dim; d++) totalSS += (v[d] - mean[d]) ** 2
  if (totalSS < 1e-12) return null // everyone identical: nothing to balance
  return { weight, dim, vec, totalSS }
}

function buildMetrics(students: AssignableStudent[]): Metric[] {
  const w = FACTOR_WEIGHTS
  return [
    metric(w.age, scalar(students.map((s) => s.age))),
    metric(w.school, oneHot(students.map((s) => s.school ?? null))),
    metric(w.experience, scalar(students.map((s) => s.experience))),
    metric(w.skills, students.map((s) => (s.skills && s.skills.length ? Float64Array.from(s.skills) : null))),
    metric(w.gender, oneHot(students.map((s) => s.gender))),
    metric(w.leadership, scalar(students.map((s) => s.leader ?? null))),
    metric(w.ethnicity, multiHot(students.map((s) => s.ethnicity))),
  ].filter((m): m is Metric => !!m)
}

// ── Company state with incremental scoring ────────────────────────────────────

class Companies {
  readonly size: number[]
  private readonly sums: Float64Array[][] // [metric][company]
  private readonly counts: number[][] // [metric][company]

  constructor(
    readonly count: number,
    private readonly metrics: Metric[],
    private readonly evenShare: number,
  ) {
    this.size = Array(count).fill(0)
    this.sums = metrics.map((m) => Array.from({ length: count }, () => new Float64Array(m.dim)))
    this.counts = metrics.map(() => Array(count).fill(0))
  }

  add(c: number, members: number[], sign: 1 | -1 = 1) {
    this.size[c] += sign * members.length
    this.metrics.forEach((m, mi) => {
      for (const i of members) {
        const v = m.vec[i]
        if (!v) continue
        this.counts[mi][c] += sign
        const s = this.sums[mi][c]
        for (let d = 0; d < m.dim; d++) s[d] += sign * v[d]
      }
    })
  }

  /** This company's share of the total cost (constant terms dropped). */
  term(c: number): number {
    let t = SIZE_WEIGHT * (this.size[c] - this.evenShare) ** 2
    this.metrics.forEach((m, mi) => {
      const n = this.counts[mi][c]
      if (n === 0) return
      let sq = 0
      const s = this.sums[mi][c]
      for (let d = 0; d < m.dim; d++) sq += s[d] * s[d]
      t += (m.weight * sq) / n / m.totalSS
    })
    return t
  }

  /** Change in this company's term if `remove` left and `add` joined. */
  delta(c: number, remove: number[], add: number[]): number {
    const before = this.term(c)
    if (remove.length) this.add(c, remove, -1)
    if (add.length) this.add(c, add, 1)
    const after = this.term(c)
    if (add.length) this.add(c, add, -1)
    if (remove.length) this.add(c, remove, 1)
    return after - before
  }
}

// ── Units ─────────────────────────────────────────────────────────────────────

interface Unit {
  members: number[] // student indexes
  company: number // -1 until placed
}

function buildUnits(students: AssignableStudent[], movable: number[]): number[][] {
  // Rule 1: group chunks; individuals are units of one.
  const byGroup = new Map<string, number[]>()
  const units: number[][] = []
  for (const i of movable) {
    const g = students[i].groupKey
    if (!g) {
      units.push([i])
      continue
    }
    const list = byGroup.get(g) ?? []
    list.push(i)
    byGroup.set(g, list)
  }
  for (const members of byGroup.values()) {
    let at = 0
    for (const size of chunkSizes(members.length)) {
      units.push(members.slice(at, at + size))
      at += size
    }
  }

  // Rule 3: teammate requests merge units while they stay within MAX_UNIT.
  const unitOf = new Map<number, number>()
  units.forEach((u, ui) => u.forEach((i) => unitOf.set(i, ui)))
  const indexById = new Map(students.map((s, i) => [s.participantId, i]))
  const parent = units.map((_, ui) => ui)
  const sizeOf = units.map((u) => u.length)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (const i of movable) {
    for (const id of students[i].teammateIds ?? []) {
      const j = indexById.get(id)
      if (j === undefined || !unitOf.has(j)) continue
      const a = find(unitOf.get(i)!)
      const b = find(unitOf.get(j)!)
      if (a === b || sizeOf[a] + sizeOf[b] > MAX_UNIT) continue
      parent[b] = a
      sizeOf[a] += sizeOf[b]
    }
  }
  const merged = new Map<number, number[]>()
  units.forEach((u, ui) => {
    const root = find(ui)
    merged.set(root, [...(merged.get(root) ?? []), ...u])
  })
  return [...merged.values()]
}

/**
 * Returns participantId → company number (1..companyCount) for every student
 * passed in, locked ones included (unchanged).
 */
export function assignCompanies(students: AssignableStudent[], companyCount: number): Map<string, number> {
  const count = Math.max(1, Math.min(10, companyCount))
  const metrics = buildMetrics(students)
  const state = new Companies(count, metrics, students.length / count)

  // Rule 2: hand-placed students first.
  const lockedIn: number[][] = Array.from({ length: count }, () => [])
  const movable: number[] = []
  students.forEach((s, i) => {
    const c = s.lockedCompany
    if (typeof c === 'number' && c >= 1 && c <= count) lockedIn[c - 1].push(i)
    else movable.push(i)
  })
  lockedIn.forEach((members, c) => members.length && state.add(c, members))

  // Who each student should be near: groupmates and requested teammates.
  const indexById = new Map(students.map((s, i) => [s.participantId, i]))
  const companyOf = new Map<number, number>()
  lockedIn.forEach((members, c) => members.forEach((i) => companyOf.set(i, c)))
  const friendsOf = students.map((s, i) => {
    const set = new Set<number>()
    for (const id of s.teammateIds ?? []) {
      const j = indexById.get(id)
      if (j !== undefined && j !== i) set.add(j)
    }
    return set
  })
  // Requests are honoured both ways round.
  friendsOf.forEach((set, i) => set.forEach((j) => friendsOf[j].add(i)))
  const groupmates = new Map<string, number[]>()
  students.forEach((s, i) => s.groupKey && groupmates.set(s.groupKey, [...(groupmates.get(s.groupKey) ?? []), i]))
  // A group too big for one unit is split on purpose: its chunks must not pull
  // each other back together.
  for (const [g, members] of groupmates) if (members.length > MAX_UNIT) groupmates.delete(g)

  const units: Unit[] = buildUnits(students, movable).map((members) => ({ members, company: -1 }))
  const pullTowards = (u: Unit, c: number) => {
    let n = 0
    for (const i of u.members) {
      const near = new Set(friendsOf[i])
      const g = students[i].groupKey
      if (g) for (const j of groupmates.get(g) ?? []) if (j !== i) near.add(j)
      for (const j of near) if (!u.members.includes(j) && companyOf.get(j) === c) n++
    }
    return n * AFFINITY
  }

  // Greedy: biggest units first, each into the company it unbalances least.
  const order = units.map((_, ui) => ui).sort((a, b) => units[b].members.length - units[a].members.length || a - b)
  for (const ui of order) {
    const u = units[ui]
    let best = 0
    let bestCost = Infinity
    for (let c = 0; c < count; c++) {
      const cost = state.delta(c, [], u.members) - pullTowards(u, c)
      if (cost < bestCost - 1e-9) {
        bestCost = cost
        best = c
      }
    }
    u.company = best
    state.add(best, u.members)
    u.members.forEach((i) => companyOf.set(i, best))
  }

  // Local search: move a unit, or swap two units of the same size, while it helps.
  const place = (u: Unit, c: number) => {
    state.add(u.company, u.members, -1)
    state.add(c, u.members)
    u.company = c
    u.members.forEach((i) => companyOf.set(i, c))
  }
  for (let pass = 0; pass < 20; pass++) {
    let improved = false
    for (const u of units) {
      for (let c = 0; c < count; c++) {
        if (c === u.company) continue
        const from = u.company
        const gain =
          state.delta(from, u.members, []) + state.delta(c, [], u.members) -
          (pullTowards(u, c) - pullTowards(u, from))
        if (gain < -1e-9) {
          place(u, c)
          improved = true
        }
      }
    }
    for (let a = 0; a < units.length; a++) {
      for (let b = a + 1; b < units.length; b++) {
        const ua = units[a]
        const ub = units[b]
        if (ua.company === ub.company || ua.members.length !== ub.members.length) continue
        const ca = ua.company
        const cb = ub.company
        const before = pullTowards(ua, ca) + pullTowards(ub, cb)
        // Score the swap with both units in their new places.
        state.add(ca, ua.members, -1)
        state.add(cb, ub.members, -1)
        const gain =
          state.delta(ca, [], ub.members) + state.delta(cb, [], ua.members) -
          (state.delta(ca, [], ua.members) + state.delta(cb, [], ub.members))
        state.add(ca, ua.members)
        state.add(cb, ub.members)
        ua.members.forEach((i) => companyOf.set(i, cb))
        ub.members.forEach((i) => companyOf.set(i, ca))
        const after = pullTowards(ua, cb) + pullTowards(ub, ca)
        ua.members.forEach((i) => companyOf.set(i, ca))
        ub.members.forEach((i) => companyOf.set(i, cb))
        if (gain - (after - before) < -1e-9) {
          state.add(ca, ua.members, -1)
          state.add(cb, ub.members, -1)
          state.add(ca, ub.members)
          state.add(cb, ua.members)
          ua.company = cb
          ub.company = ca
          ua.members.forEach((i) => companyOf.set(i, cb))
          ub.members.forEach((i) => companyOf.set(i, ca))
          improved = true
        }
      }
    }
    if (!improved) break
  }

  const result = new Map<string, number>()
  students.forEach((s, i) => result.set(s.participantId, (companyOf.get(i) ?? 0) + 1))
  return result
}

/**
 * Best-fit companies for students not yet placed (late registrants, students
 * who never answered), leaving everyone already in a company where they are.
 */
export function suggestCompanies(
  placed: (AssignableStudent & { company: number })[],
  unplaced: AssignableStudent[],
  companyCount: number,
): Map<string, number> {
  const all = [
    ...placed.map((s) => ({ ...s, lockedCompany: s.company })),
    ...unplaced.map((s) => ({ ...s, lockedCompany: null })),
  ]
  const result = assignCompanies(all, companyCount)
  const out = new Map<string, number>()
  for (const s of unplaced) out.set(s.participantId, result.get(s.participantId)!)
  return out
}
