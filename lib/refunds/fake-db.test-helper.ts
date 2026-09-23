// A small in-memory stand-in for the Supabase query builder, enough for the
// refund modules: select/eq/in/limit/maybeSingle/single/insert/upsert. Filters
// are applied to the fixture rows; writes are recorded for assertions.
type Row = Record<string, unknown>

export interface FakeDb {
  db: { from: (table: string) => unknown }
  inserts: { table: string; rows: Row[] }[]
  upserts: { table: string; rows: Row[]; opts: unknown }[]
  /** Makes the next insert into `table` fail with this message. */
  failInsert: (table: string, message: string) => void
}

export function fakeDb(tables: Record<string, Row[]>): FakeDb {
  const inserts: FakeDb['inserts'] = []
  const upserts: FakeDb['upserts'] = []
  const failing = new Map<string, string>()

  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = []
    let limitN: number | null = null
    let written: Row[] | null = null
    let writeError: { message: string } | null = null

    const rows = () => {
      if (written) return written
      const out = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
      return limitN === null ? out : out.slice(0, limitN)
    }
    const result = () => (writeError ? { data: null, error: writeError } : { data: rows(), error: null })

    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), q),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), q),
      order: () => q,
      limit: (n: number) => ((limitN = n), q),
      maybeSingle: async () => (writeError ? { data: null, error: writeError } : { data: rows()[0] ?? null, error: null }),
      single: async () => (writeError ? { data: null, error: writeError } : { data: rows()[0] ?? null, error: null }),
      insert: (payload: Row | Row[]) => {
        const list = Array.isArray(payload) ? payload : [payload]
        const msg = failing.get(table)
        if (msg) {
          failing.delete(table)
          writeError = { message: msg }
        } else {
          written = list.map((r, i) => ({ id: `${table}-${inserts.length}-${i}`, ...r }))
          inserts.push({ table, rows: written })
        }
        return q
      },
      upsert: (payload: Row[], opts: unknown) => {
        upserts.push({ table, rows: payload, opts })
        written = payload
        return q
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve, reject),
    }
    return q
  }

  return {
    db: { from: builder },
    inserts,
    upserts,
    failInsert: (table, message) => failing.set(table, message),
  }
}
