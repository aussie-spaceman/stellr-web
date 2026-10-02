// An in-memory stand-in for the parts of supabase-js the e-sign code uses:
// filtered selects, counts, inserts, updates, upserts and deletes on tables,
// plus a storage bucket. Enough to test behaviour against real data instead of
// mocking each query chain by hand. Not a PostgREST implementation: unknown
// filters throw, so a test cannot pass by accident.

type Row = Record<string, unknown>
type Op = (row: Row) => boolean

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  return String(a) < String(b) ? -1 : 1
}

function coerce(raw: string): unknown {
  if (raw === 'null') return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  return raw
}

/** Parses the subset of PostgREST `or` syntax the code uses: `a.is.null,b.lte.X`. */
function parseOr(expr: string): Op {
  const clauses = expr.split(',').map((c) => {
    const [col, op, ...rest] = c.split('.')
    const value = coerce(rest.join('.'))
    switch (op) {
      case 'is':  return (r: Row) => (r[col] ?? null) === value
      case 'eq':  return (r: Row) => r[col] === value
      case 'neq': return (r: Row) => r[col] !== value
      case 'lt':  return (r: Row) => r[col] != null && cmp(r[col], value) < 0
      case 'lte': return (r: Row) => r[col] != null && cmp(r[col], value) <= 0
      case 'gt':  return (r: Row) => r[col] != null && cmp(r[col], value) > 0
      case 'gte': return (r: Row) => r[col] != null && cmp(r[col], value) >= 0
      default: throw new Error(`fake-supabase: unsupported or() operator ${op}`)
    }
  })
  return (r) => clauses.some((c) => c(r))
}

/** SQL LIKE → RegExp: % any run, _ any one character, \ escapes the next. */
function likeToRegex(pattern: string, flags = ''): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]
    if (ch === '\\' && i + 1 < pattern.length) out += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    else if (ch === '%') out += '.*'
    else if (ch === '_') out += '.'
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`, flags)
}

let idCounter = 0
export const fakeId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`

export interface FakeDb {
  tables: Record<string, Row[]>
  objects: Map<string, Uint8Array>
  rpcs: Record<string, (args: Record<string, unknown>) => unknown>
  client: never
  table(name: string): Row[]
}

export function fakeSupabase(
  initial: Record<string, object[]> = {},
  opts: { failOn?: (table: string, action: string) => string | null } = {},
): FakeDb {
  const tables: Record<string, Row[]> = {}
  for (const [k, rows] of Object.entries(initial)) tables[k] = rows.map((r) => ({ ...(r as Row) }))
  const objects = new Map<string, Uint8Array>()
  const table = (name: string) => (tables[name] ??= [])

  function builder(name: string) {
    const filters: Op[] = []
    let action: 'select' | 'update' | 'delete' | 'insert' | 'upsert' = 'select'
    let payload: Row | Row[] | null = null
    let upsertConflict: string[] = []
    let returning = false
    let countMode = false
    let head = false
    let orderBy: { col: string; asc: boolean }[] = []
    let limitN: number | null = null
    let rangeFrom = 0
    let single: 'single' | 'maybe' | null = null

    const b = {
      select(_cols?: string, o?: { count?: string; head?: boolean }) {
        if (action === 'select') {
          countMode = o?.count === 'exact'
          head = !!o?.head
        } else {
          returning = true
        }
        return b
      },
      insert(p: Row | Row[]) { action = 'insert'; payload = p; return b },
      update(p: Row) { action = 'update'; payload = p; return b },
      delete() { action = 'delete'; return b },
      upsert(p: Row | Row[], o?: { onConflict?: string }) {
        action = 'upsert'; payload = p; upsertConflict = (o?.onConflict ?? 'id').split(','); return b
      },
      eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return b },
      neq(c: string, v: unknown) { filters.push((r) => r[c] !== v); return b },
      is(c: string, v: unknown) { filters.push((r) => (r[c] ?? null) === v); return b },
      in(c: string, vs: unknown[]) { filters.push((r) => vs.includes(r[c])); return b },
      gt(c: string, v: unknown) { filters.push((r) => r[c] != null && cmp(r[c], v) > 0); return b },
      gte(c: string, v: unknown) { filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return b },
      lt(c: string, v: unknown) { filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return b },
      lte(c: string, v: unknown) { filters.push((r) => r[c] != null && cmp(r[c], v) <= 0); return b },
      like(c: string, pattern: string) {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`)
        filters.push((r) => typeof r[c] === 'string' && re.test(r[c] as string))
        return b
      },
      ilike(c: string, pattern: string) {
        const re = likeToRegex(pattern, 'i')
        filters.push((r) => typeof r[c] === 'string' && re.test(r[c] as string))
        return b
      },
      not(c: string, op: string, v: unknown) {
        if (op !== 'is') throw new Error(`fake-supabase: unsupported not() operator ${op}`)
        filters.push((r) => (r[c] ?? null) !== v)
        return b
      },
      or(expr: string) { filters.push(parseOr(expr)); return b },
      order(c: string, o?: { ascending?: boolean }) { orderBy.push({ col: c, asc: o?.ascending !== false }); return b },
      limit(n: number) { limitN = n; return b },
      range(from: number, to: number) { rangeFrom = from; limitN = to - from + 1; return b },
      single() { single = 'single'; return b },
      maybeSingle() { single = 'maybe'; return b },
      then<T>(resolve: (v: { data: unknown; error: { message: string } | null; count?: number | null }) => T, reject?: (e: unknown) => T) {
        try {
          return Promise.resolve(run()).then(resolve, reject)
        } catch (err) {
          return Promise.reject(err).then(resolve, reject)
        }
      },
    }

    const matches = (r: Row) => filters.every((f) => f(r))

    function shape(rows: Row[]) {
      if (single) {
        if (rows.length > 1) return { data: null, error: { message: 'multiple rows returned' } }
        if (rows.length === 0) {
          return single === 'single'
            ? { data: null, error: { message: 'no rows returned' } }
            : { data: null, error: null }
        }
        return { data: { ...rows[0] }, error: null }
      }
      return { data: rows.map((r) => ({ ...r })), error: null }
    }

    function run() {
      const failure = opts.failOn?.(name, action)
      if (failure) return { data: null, error: { message: failure }, count: null }
      const rows = table(name)

      if (action === 'select') {
        let out = rows.filter(matches)
        for (const { col, asc } of [...orderBy].reverse()) {
          out = [...out].sort((a, z) => (asc ? 1 : -1) * cmp(a[col], z[col]))
        }
        if (limitN !== null) out = out.slice(rangeFrom, rangeFrom + limitN)
        if (countMode) return { data: head ? null : out, error: null, count: out.length }
        return shape(out)
      }

      if (action === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const inserted = items.map((p) => ({ id: p.id ?? fakeId(), ...p }))
        rows.push(...inserted)
        return returning ? shape(inserted) : { data: null, error: null }
      }

      if (action === 'upsert') {
        const items = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const out: Row[] = []
        for (const p of items) {
          const existing = rows.find((r) => upsertConflict.every((k) => r[k] === p[k]))
          if (existing) { Object.assign(existing, p); out.push(existing) }
          else { const n = { id: p.id ?? fakeId(), ...p }; rows.push(n); out.push(n) }
        }
        return returning ? shape(out) : { data: null, error: null }
      }

      if (action === 'update') {
        const hit = rows.filter(matches)
        for (const r of hit) Object.assign(r, payload)
        return returning ? shape(hit) : { data: null, error: null }
      }

      // delete
      const hit = rows.filter(matches)
      tables[name] = rows.filter((r) => !hit.includes(r))
      return returning ? shape(hit) : { data: null, error: null }
    }

    return b
  }

  const storage = {
    from(bucket: string) {
      const key = (p: string) => `${bucket}/${p}`
      return {
        async upload(path: string, body: Uint8Array | ArrayBuffer | string, o?: { upsert?: boolean }) {
          if (objects.has(key(path)) && !o?.upsert) return { data: null, error: { message: 'The resource already exists' } }
          const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body as ArrayBuffer)
          objects.set(key(path), bytes)
          return { data: { path }, error: null }
        },
        async download(path: string) {
          const bytes = objects.get(key(path))
          if (!bytes) return { data: null, error: { message: 'Object not found' } }
          return { data: new Blob([new Uint8Array(bytes)]), error: null }
        },
        async remove(paths: string[]) {
          for (const p of paths) objects.delete(key(p))
          return { data: paths.map((name) => ({ name })), error: null }
        },
        async createSignedUrl(path: string, ttl: number, o?: { download?: string }) {
          if (!objects.has(key(path))) return { data: null, error: { message: 'Object not found' } }
          const dl = o?.download ? `&download=${encodeURIComponent(o.download)}` : ''
          return { data: { signedUrl: `https://storage.test/${key(path)}?ttl=${ttl}${dl}` }, error: null }
        },
      }
    },
  }

  // RPCs are registered per test: `fake.rpcs.name = (args) => result`.
  const rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {}
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const handler = rpcs[fn]
    if (!handler) return { data: null, error: { message: `fake-supabase: no rpc ${fn}` } }
    try {
      return { data: await handler(args), error: null }
    } catch (err) {
      return { data: null, error: { message: err instanceof Error ? err.message : String(err) } }
    }
  }

  const client = { from: builder, storage, rpc }
  return { tables, objects, rpcs, client: client as never, table }
}
