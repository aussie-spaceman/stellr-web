// A supabase-js stand-in for the cross-tenant / IDOR suite.
//
// Every table holds exactly one tenant-B ("Canary Academy") row, the
// HONEY ROW, plus the tenant-A caller's own rows (just their `members` row).
// The honey row is adversarial: it satisfies EVERY filter except one on an
// identity column (an id, an owner, an email, a slug, a token, a tenant). So
// a query only misses it when it is scoped to the caller's identity, which is
// exactly the property under test:
//
//   .from('teams').select('*').eq('id', <honey id>)                 → honey row (LEAK if returned)
//   .from('teams').select('*').eq('id', <honey id>).eq('owner_member_id', me) → nothing
//
// Uuid columns (`id`, `event_id`, `member_id`, …) match ANY Canary id on the
// honey row: the id the caller sent, the Canary member id, or a Canary column
// id. So `.eq('member_id', <sent memberId>)` finds it just as `.eq('id', …)`
// does. When read, a uuid column shows the value it was filtered on (an echo
// tells the caller nothing), and otherwise a distinct per-column Canary id
// (`honeyColumnId`) the caller never sent: a response of bare ids and foreign
// keys is still visibly tenant B's.
//
// Writes are recorded: an update or delete whose filters match the honey row,
// an insert/upsert whose payload carries a honeytoken (joining B's team, a
// registration for B's event), an rpc() whose arguments carry one, or a
// storage write under a Canary path, is a HONEY WRITE and fails the case. An
// rpc runs SQL the harness cannot see, so a Canary value reaching one counts
// as a write until a reviewer accepts it.
//
// `touched` records whether a Canary value reached the database at all (a
// filter, a payload, an rpc argument, a storage path). A 400 with nothing
// touched means request validation refused before the id was used: the case
// proved nothing, and the harness says so (`unexercised`).
//
// `honeyAbsent` empties the tables of the honey row, for the differential run
// that catches an existence oracle (a 2xx whose body changes with B's row).
//
// Not a PostgREST implementation. Unknown builder methods are accepted and
// ignored (they cannot widen a match: only filters narrow it), so a new query
// shape cannot crash the harness into a false pass. auth.admin and realtime
// are inert.
import { CANARY_TENANT, HONEYTOKEN_VALUES, HONEYTOKENS, honeyColumnId, isCanaryId } from '@/lib/testing/honeytokens'

type Row = Record<string, unknown>

export interface HoneyWrite {
  table: string
  op: string
  detail: string
}

export interface HoneyDbState {
  /** Writes that touched or referenced a tenant-B row. Must stay empty. */
  writes: HoneyWrite[]
  /** Tables whose honey row a query returned (not itself a failure). */
  honeyReads: string[]
  /** The tenant-A caller's own rows, by table. */
  callerRows: Record<string, Row[]>
  /** A Canary value reached a filter, payload, rpc argument or storage path. */
  touched: boolean
  /** The differential run: no table holds the honey row. */
  honeyAbsent: boolean
  /** Non-identity columns a case fixture sets on the honey row (test/idor/case-fixtures.ts). */
  honeyColumns: Row
  /** Ids handed to inserted rows, per run so two runs are comparable. */
  insertSeq: number
}

export function newHoneyDbState(
  callerRows: Record<string, Row[]> = {},
  opts: { honeyAbsent?: boolean; honeyColumns?: Row } = {},
): HoneyDbState {
  return {
    writes: [],
    honeyReads: [],
    callerRows,
    touched: false,
    honeyAbsent: opts.honeyAbsent === true,
    honeyColumns: opts.honeyColumns ?? {},
    insertSeq: 0,
  }
}

// ── column classification ────────────────────────────────────────────────────

const WILDCARD = Symbol('wildcard')
/** A uuid column on the honey row: equal to any Canary id. */
const CANARY_ID = Symbol('canary-id')

const OWNER =
  /(^|_)(member|members|user|clerk|owner|author|creator|created_by|submitted_by|uploaded_by|requested_by|flagged_by|recipient|signer|holder|participant|guardian|parent|student|mentor|coach|coachee|teacher|host|requester|reporter|invitee|inviter|buyer|customer|contact|person|account)(_|$)/

/**
 * The value an IDENTITY column holds on the honey row, or WILDCARD for a
 * column that matches any filter (status, dates, flags, amounts…).
 */
function identityValue(col: string): unknown {
  const c = col.toLowerCase()
  if (c === 'tenant_id') return CANARY_TENANT.id
  if (c === 'id' || c === 'uuid') return CANARY_ID
  if (c === 'clerk_user_id' || c === 'user_id' || c.endsWith('clerk_id') || c.endsWith('clerk_user_id')) return HONEYTOKENS.clerkUserId
  if (c.endsWith('_ids')) return [CANARY_ID]
  if (c.endsWith('_id') || c.endsWith('_uuid')) return CANARY_ID
  if (c.includes('email')) return HONEYTOKENS.email
  if (c.includes('slug') || c === 'event' || c === 'event_ref' || c === 'event_key') return HONEYTOKENS.eventSlug
  if (c.includes('sanity')) return HONEYTOKENS.sanityId
  if (c.includes('token') || c.endsWith('_hash') || c === 'hash' || c === 'code' || c === 'key' || c.endsWith('_code') || c.endsWith('_key')) {
    return HONEYTOKENS.token
  }
  if (c === 'number' || c.endsWith('_number')) return HONEYTOKENS.credentialNumber
  if (c === 'path' || c.endsWith('_path') || c.endsWith('storage_key')) return HONEYTOKENS.storagePath
  if (OWNER.test(c)) return HONEYTOKENS.memberId
  return WILDCARD
}

/** The value a non-identity column shows when the honey row is read. */
function displayValue(col: string): unknown {
  const c = col.toLowerCase()
  if (/(deleted|archived|revoked|cancelled|canceled|withdrawn|expired|disabled|suspended|refunded)_at$/.test(c)) return null
  if (c === 'date_of_birth' || c === 'dob' || c === 'birth_date') return '2008-01-01'
  if (/(_at|_on|date|_until|_from|^starts|^ends)$/.test(c)) return '2026-03-01T00:00:00.000Z'
  if (/^(is|has|can|allow|show|requires?|enabled|active|published|visible)(_|$)/.test(c)) return true
  if (/(amount|price|total|count|cents|qty|quantity|seats|capacity|fee|minor|position|index|size|version|grade|age)/.test(c)) return 100
  if (/(^|_)(name|title|label)$/.test(c)) return HONEYTOKENS.personName
  if (c === 'status' || c.endsWith('_status') || c === 'lifecycle') return 'active'
  if (c === 'role') return 'member'
  if (/(raw|metadata|data|payload|answers|settings|config|details|meta|json|branding)$/.test(c)) return { note: HONEYTOKENS.text }
  return HONEYTOKENS.text
}

/** Columns a query pinned with eq / in / match, and the value it pinned. */
type Echo = Record<string, unknown>

function honeyColumnValue(col: string, echo: Echo = {}): unknown {
  const v = identityValue(col)
  if (v === WILDCARD) return displayValue(col)
  if (col in echo) return Array.isArray(v) ? [echo[col]] : echo[col]
  if (v === CANARY_ID) return honeyColumnId(col)
  if (Array.isArray(v) && v[0] === CANARY_ID) return [honeyColumnId(col)]
  return v
}

const DEFAULT_COLUMNS = [
  'id', 'tenant_id', 'member_id', 'clerk_user_id', 'event_slug', 'email', 'first_name', 'last_name',
  'name', 'title', 'status', 'notes', 'created_at',
]

/**
 * The honey row for a table: an object that answers any column read. Embedded
 * relations in the select (`participants(*)`, `event:events(title)`) are filled
 * with nested honey rows: an array for a plural name, an object otherwise.
 */
function honeyRow(cols?: string, echo: Echo = {}, columns: Row = {}): Row {
  const target: Row = {}
  for (const c of DEFAULT_COLUMNS) target[c] = honeyColumnValue(c, echo)
  for (const [c, v] of Object.entries(columns)) {
    // Only a column that filters treat as a wildcard: never who the row belongs to.
    if (identityValue(c) === WILDCARD) target[c] = v
  }
  for (const part of splitTop((cols ?? '').replace(/\s+/g, ''))) {
    const m = part.match(/^(?:(\w+):)?(\w+)(?:![\w]+)?\((.*)\)$/)
    if (!m) continue
    const key = m[1] ?? m[2]
    const nested = honeyRow(m[3])
    target[key] = /s$/.test(m[2]) && !m[1] ? [nested] : /s$/.test(key) ? [nested] : nested
  }
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop !== 'string' || prop === 'then' || prop === 'toJSON' || prop === 'constructor') {
        return Reflect.get(t, prop, recv)
      }
      if (!(prop in t)) t[prop] = honeyColumnValue(prop, echo)
      return t[prop]
    },
  })
}

// ── filters ──────────────────────────────────────────────────────────────────

type Kind = 'honey' | 'caller'
type Pred = (row: Row, kind: Kind) => boolean

/**
 * The value of `col` used for matching, or WILDCARD when any comparison
 * passes. A caller row compares strictly on the columns it has, and on every
 * identity column; anything else on it is a wildcard too, so a narrower select
 * (an `is_active` filter, say) does not hide the caller from themselves.
 */
function matchValue(row: Row, kind: Kind, col: string): unknown {
  const base = col.split('->')[0].split('.')[0]
  if (kind === 'honey') return identityValue(base)
  if (base in row) return row[base]
  return identityValue(base) === WILDCARD ? WILDCARD : undefined
}

function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (typeof v === 'string') return v.replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
  return [v]
}

function likeToRegExp(p: string, flags: string): RegExp {
  const esc = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/\*/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${esc}$`, flags)
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return a.some((x) => same(x, b))
  if (a === CANARY_ID) return isCanaryId(b)
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

function opPred(col: string, op: string, value: unknown): Pred {
  return (row, kind) => {
    const raw = matchValue(row, kind, col)
    if (raw === WILDCARD) return true
    // Ordering and pattern operators compare a uuid column as the sent id.
    const v = raw === CANARY_ID && !['eq', 'neq', 'in', 'is'].includes(op) ? HONEYTOKENS.id : raw
    switch (op) {
      case 'eq':
        return same(v, value)
      case 'neq':
        return !same(v, value)
      case 'is':
        return value === null ? v == null : same(v, value)
      case 'in':
        return asList(value).some((x) => same(v, x))
      case 'like':
      case 'ilike':
        return typeof v === 'string' && likeToRegExp(String(value), op === 'ilike' ? 'i' : '').test(v)
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (v == null) return false
        const a = String(v)
        const b = String(value)
        return op === 'gt' ? a > b : op === 'gte' ? a >= b : op === 'lt' ? a < b : a <= b
      }
      case 'cs':
      case 'contains':
      case 'ov':
      case 'overlaps': {
        const want = asList(typeof value === 'string' ? value.replace(/^\{|\}$/g, '') : value)
        const have = Array.isArray(v) ? v : [v]
        return op === 'cs' || op === 'contains' ? want.every((w) => have.some((h) => same(h, w))) : want.some((w) => have.some((h) => same(h, w)))
      }
      default:
        // Full-text and other operators narrow; the honey row is treated as
        // matching, so an unknown operator can never hide it.
        return true
    }
  }
}

function splitTop(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function parseClause(clause: string): Pred {
  const c = clause.trim()
  const group = c.match(/^(and|or)\((.*)\)$/)
  if (group) {
    const parts = splitTop(group[2]).map(parseClause)
    return group[1] === 'and' ? (r, k) => parts.every((p) => p(r, k)) : (r, k) => parts.some((p) => p(r, k))
  }
  const [col, ...rest] = c.split('.')
  let op = rest.shift() ?? 'eq'
  let negate = false
  if (op === 'not') {
    negate = true
    op = rest.shift() ?? 'eq'
  }
  const raw = rest.join('.')
  const value = raw === 'null' ? null : raw === 'true' ? true : raw === 'false' ? false : raw
  const p = opPred(col, op, value)
  return negate ? notPred(col, p) : p
}

function notPred(col: string, p: Pred): Pred {
  return (row, kind) => {
    if (matchValue(row, kind, col) === WILDCARD) return true
    return !p(row, kind)
  }
}

// ── the client ───────────────────────────────────────────────────────────────

const AUDIT_TABLE = /(audit|(^|_)logs?$|_log_|errors?$|rate_limit|webhook_events|security_events|tenancy_derivation)/

function carriesHoneytoken(v: unknown, ignore: readonly string[] = []): string | null {
  if (v == null) return null
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    return HONEYTOKEN_VALUES.find((h) => !ignore.includes(h) && s.includes(h.toLowerCase())) ?? null
  }
  if (Array.isArray(v)) {
    for (const x of v) {
      const hit = carriesHoneytoken(x, ignore)
      if (hit) return hit
    }
    return null
  }
  if (typeof v === 'object') return carriesHoneytoken(Object.values(v as Row), ignore)
  return null
}

class Query {
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' | 'rpc' = 'select'
  preds: Pred[] = []
  values: unknown = undefined
  wantSingle = false
  wantMaybe = false
  head = false
  count: string | undefined
  returning = false
  cols: string | undefined
  /** eq / in / match pins, echoed back by the honey row's columns. */
  echo: Echo = {}

  constructor(
    private db: HoneyDbState,
    private table: string,
  ) {}

  select(cols?: string, opts?: { head?: boolean; count?: string }) {
    if (typeof cols === 'string') this.cols = cols
    if (this.op === 'select') {
      if (opts?.head) this.head = true
      if (opts?.count) this.count = opts.count
    } else this.returning = true
    return this
  }
  insert(v: unknown) {
    this.op = 'insert'
    this.values = v
    return this
  }
  upsert(v: unknown) {
    this.op = 'upsert'
    this.values = v
    return this
  }
  update(v: unknown) {
    this.op = 'update'
    this.values = v
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(c: string, v: unknown) { return this.pin(c, v).add(opPred(c, 'eq', v), v) }
  neq(c: string, v: unknown) { return this.add(opPred(c, 'neq', v), v) }
  gt(c: string, v: unknown) { return this.add(opPred(c, 'gt', v), v) }
  gte(c: string, v: unknown) { return this.add(opPred(c, 'gte', v), v) }
  lt(c: string, v: unknown) { return this.add(opPred(c, 'lt', v), v) }
  lte(c: string, v: unknown) { return this.add(opPred(c, 'lte', v), v) }
  like(c: string, v: unknown) { return this.add(opPred(c, 'like', v), v) }
  ilike(c: string, v: unknown) { return this.add(opPred(c, 'ilike', v), v) }
  is(c: string, v: unknown) { return this.add(opPred(c, 'is', v), v) }
  in(c: string, v: unknown) {
    const canary = asList(v).find((x) => isCanaryId(x) || carriesHoneytoken(x))
    if (canary !== undefined) this.pin(c, canary)
    return this.add(opPred(c, 'in', v), v)
  }
  contains(c: string, v: unknown) { return this.add(opPred(c, 'contains', v), v) }
  overlaps(c: string, v: unknown) { return this.add(opPred(c, 'overlaps', v), v) }
  match(obj: Row) {
    for (const [c, v] of Object.entries(obj ?? {})) this.eq(c, v)
    return this
  }
  filter(c: string, op: string, v: unknown) {
    if (op === 'eq') this.pin(c, v)
    return op.startsWith('not.') ? this.add(notPred(c, opPred(c, op.slice(4), v)), v) : this.add(opPred(c, op, v), v)
  }
  not(c: string, op: string, v: unknown) { return this.add(notPred(c, opPred(c, op, v)), v) }
  or(expr: string) {
    const parts = splitTop(expr).map(parseClause)
    return this.add((r, k) => parts.some((p) => p(r, k)), expr)
  }
  /** A row returned under `col = v` has `col = v`: showing it back tells the caller nothing. */
  private pin(c: string, v: unknown) {
    const base = c.split('->')[0].split('.')[0]
    if (typeof v === 'string' || typeof v === 'number') this.echo[base] = v
    return this
  }
  single() {
    this.wantSingle = true
    return this
  }
  maybeSingle() {
    this.wantMaybe = true
    return this
  }
  private add(p: Pred, value?: unknown) {
    if (isCanaryId(value) || carriesHoneytoken(value)) this.db.touched = true
    this.preds.push(p)
    return this
  }

  private rows(): { row: Row; kind: Kind }[] {
    const caller = (this.db.callerRows[this.table] ?? []).map((r) => ({ row: { ...r }, kind: 'caller' as Kind }))
    const all = this.db.honeyAbsent ? caller : [...caller, { row: honeyRow(this.cols, this.echo, this.db.honeyColumns), kind: 'honey' as Kind }]
    return all.filter(({ row, kind }) => this.preds.every((p) => p(row, kind)))
  }

  exec(): { data: unknown; error: unknown; count?: number | null; status: number } {
    if (this.op === 'rpc') {
      const hit = carriesHoneytoken(this.values)
      if (hit) {
        this.db.touched = true
        this.db.writes.push({
          table: `rpc:${this.table}`,
          op: 'rpc',
          detail: `arguments carry the Canary value ${hit} (the function's SQL is not modelled, so this counts as a write)`,
        })
      }
      return { data: null, error: null, status: 200 }
    }
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[]
      if (carriesHoneytoken(list)) this.db.touched = true
      // Storing an email address the caller typed (a contact form, an invite)
      // is the form's purpose, not a write to tenant B: only ids, slugs, paths
      // and tokens in a payload count. Filters on an email still do.
      const hit = carriesHoneytoken(list, [HONEYTOKENS.email])
      if (hit && !AUDIT_TABLE.test(this.table)) {
        this.db.writes.push({ table: this.table, op: this.op, detail: `payload carries the Canary value ${hit}` })
      }
      const out = list.map((r) => ({ id: `00000000-0000-4000-8000-${String(++this.db.insertSeq).padStart(12, '0')}`, ...(r ?? {}) }))
      return this.shape(out)
    }
    const matched = this.rows()
    if (matched.some((m) => m.kind === 'honey')) {
      if (this.op === 'update' || this.op === 'delete') {
        this.db.writes.push({ table: this.table, op: this.op, detail: 'filters matched the Canary row (not scoped to the caller)' })
      } else {
        this.db.honeyReads.push(this.table)
      }
    }
    const rows = matched.map((m) => (this.op === 'update' ? { ...m.row, ...(this.values as Row) } : m.row))
    if (this.op !== 'select' && !this.returning) return { data: null, error: null, status: 204 }
    return this.shape(rows)
  }

  private shape(rows: Row[]) {
    const count = this.count ? rows.length : null
    if (this.head) return { data: null, error: null, count, status: 200 }
    if (this.wantSingle) {
      if (rows.length !== 1) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }, count, status: 406 }
      }
      return { data: rows[0], error: null, count, status: 200 }
    }
    if (this.wantMaybe) {
      if (rows.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' }, count, status: 406 }
      return { data: rows[0] ?? null, error: null, count, status: 200 }
    }
    return { data: rows, error: null, count, status: 200 }
  }

  then<T>(resolve: (v: ReturnType<Query['exec']>) => T, reject?: (e: unknown) => T) {
    try {
      return Promise.resolve(this.exec()).then(resolve, reject)
    } catch (e) {
      return reject ? Promise.resolve(reject(e)) : Promise.reject(e)
    }
  }
}

/** Wraps a Query so any unknown builder method (order, limit, range, csv…) chains. */
function chain(q: Query): Query {
  const proxy: Query = new Proxy(q, {
    get(t, prop, recv) {
      if (prop in t) {
        const v = Reflect.get(t, prop, recv)
        if (typeof v === 'function' && prop !== 'then' && prop !== 'exec') {
          return (...args: unknown[]) => {
            const r = (v as (...a: unknown[]) => unknown).apply(t, args)
            return r === t ? proxy : r
          }
        }
        return v
      }
      if (typeof prop === 'symbol') return undefined
      return () => proxy
    },
  })
  return proxy
}

function inert(): unknown {
  const fn = () => Promise.resolve({ data: null, error: null })
  return new Proxy(fn, {
    get: (_t, prop) => (prop === 'then' ? undefined : inert()),
    apply: () => {
      const result = Promise.resolve({ data: null, error: null })
      return new Proxy(result, {
        get: (t, prop) => {
          const v = Reflect.get(t, prop)
          return typeof v === 'function' ? v.bind(t) : inert()
        },
      })
    },
  })
}

function storageBucket(db: HoneyDbState, bucket: string) {
  const honeyPath = (p: unknown) => {
    const hit = carriesHoneytoken(p)
    if (hit) db.touched = true
    return hit
  }
  const write = (op: string, p: unknown) => {
    const hit = honeyPath(p)
    if (hit) db.writes.push({ table: `storage:${bucket}`, op, detail: `object path carries ${hit}` })
  }
  return {
    download: async (p: string) =>
      honeyPath(p) && !db.honeyAbsent
        ? { data: new Blob([HONEYTOKENS.text]), error: null }
        : { data: null, error: { message: 'Object not found', statusCode: '404' } },
    createSignedUrl: async (p: string) => {
      honeyPath(p)
      return { data: { signedUrl: `https://storage.idor.invalid/${bucket}/${p}?token=signed` }, error: null }
    },
    createSignedUrls: async (ps: string[]) => ({
      data: ps.map((p) => ({ path: p, signedUrl: `https://storage.idor.invalid/${bucket}/${p}?token=signed`, error: null })),
      error: null,
    }),
    createSignedUploadUrl: async (p: string) => {
      write('createSignedUploadUrl', p)
      return { data: { signedUrl: `https://storage.idor.invalid/${bucket}/${p}`, token: 'upload', path: p }, error: null }
    },
    getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage.idor.invalid/${bucket}/${p}` } }),
    upload: async (p: string) => {
      write('upload', p)
      return { data: { path: p }, error: null }
    },
    update: async (p: string) => {
      write('update', p)
      return { data: { path: p }, error: null }
    },
    move: async (a: string, b: string) => {
      write('move', [a, b])
      return { data: null, error: null }
    },
    copy: async (a: string, b: string) => {
      write('copy', [a, b])
      return { data: null, error: null }
    },
    remove: async (ps: string[]) => {
      write('remove', ps)
      return { data: [], error: null }
    },
    list: async () => ({ data: [], error: null }),
    info: async () => ({ data: null, error: { message: 'Object not found' } }),
    exists: async () => ({ data: false, error: null }),
  }
}

/** A client shaped like supabase-js's, backed by the honey tables. */
export function honeyClient(db: HoneyDbState): unknown {
  const client = {
    from: (table: string) => chain(new Query(db, table)),
    schema: () => client,
    rpc: (fn: string, args?: unknown) => {
      const q = new Query(db, String(fn))
      q.op = 'rpc'
      q.values = args
      return chain(q)
    },
    storage: { from: (bucket: string) => storageBucket(db, bucket) },
    auth: inert(),
    channel: () => inert(),
    removeChannel: async () => 'ok',
    removeAllChannels: async () => [],
    realtime: inert(),
    functions: inert(),
  }
  return client
}
