// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'
import { OPTIONAL_EVENT_TABLES, collectSources, measure, optionalEventWrites, summarize } from '../scripts/s5-inventory.mjs'

// S5 data access (C2): the 7 tables whose event key is optional. On these the S3
// trigger logs `no_key` for a row with no event, and enforce mode would refuse
// it, so the app must write tenant_id itself before the enforce flip
// (docs/TENANCY-S3.md, "How tenant_id is derived").
//
// REPORT MODE: the writers are listed, not failed. Lane C PRs set tenant_id
// per area, and this test becomes enforcing once they have. The scan follows a
// `.from('table').insert|upsert(…)` chain and reads the row literal, so a row
// built elsewhere shows as `indirect`, and a query builder kept in a variable
// is not seen. Treat the list as a floor, not a complete inventory.
//
// To read the list: run this file with --reporter=verbose (the default reporter
// hides a passing test's logs), or `npx tsx scripts/s5-inventory.mjs --json`.

describe('optional-event tenant_id (report mode)', () => {
  it('lists the live writers', () => {
    const m = measure(collectSources(process.cwd()))
    const s = summarize(m)
    const rows = m.optionalWriters.map((w: { file: string; line: number; table: string; op: string; tenantId: string }) => `  ${w.table}.${w.op} ${w.tenantId} ${w.file}:${w.line}`)
    console.info(`Optional-event writes: ${s.optionalEventWritesExplicit} of ${s.optionalEventWrites} set tenant_id explicitly.\n${rows.join('\n')}`)
    // A scan that found nothing has broken, not succeeded.
    expect(m.optionalWriters.some((w: { table: string }) => w.table === 'store_orders')).toBe(true)
  }, 120_000)

  it('the table list is the one the registry and the S3 doc name', () => {
    const fromRegistry = Object.entries(TABLE_REGISTRY)
      .filter(([, e]) => e.tenantColumn === 'derived' && /\boptional\b/.test(e.note ?? ''))
      .map(([t]) => t.replace(/^public\./, ''))
      .sort()
    expect(fromRegistry).toEqual([...OPTIONAL_EVENT_TABLES].sort())
    const doc = readFileSync('docs/TENANCY-S3.md', 'utf8')
    for (const t of OPTIONAL_EVENT_TABLES) expect(doc).toContain(`\`${t}\``)
  })
})

describe('optionalEventWrites', () => {
  const scan = (body: string) => optionalEventWrites('lib/x.ts', `async function f(db, row, rows) {\n${body}\n}`)

  it('marks a tenant_id from a tenant context explicit', () => {
    expect(scan("await db.from('store_orders').insert({ tenant_id: ctx.tenantId, total: 1 })")[0]).toMatchObject({
      table: 'store_orders',
      op: 'insert',
      tenantId: 'explicit',
    })
    expect(scan("await db.from('member_groups').upsert([{ tenant_id: tenantId }, { tenant_id: tenant.id }]).select()")[0].tenantId).toBe('explicit')
    expect(scan("await db.from('store_orders').insert({ tenant_id: currentTenantId(), total: 1 })")[0].tenantId).toBe('explicit')
    expect(scan("await db.from('store_orders').insert({ ...row, tenant_id: ctx.tenantId })")[0].tenantId).toBe('explicit')
  })

  it('marks a literal row without tenant_id, or with a null one, missing', () => {
    expect(scan("await db.from('training_modules').insert({ title: 'x' })")[0].tenantId).toBe('missing')
    expect(scan("await db.from('community_spaces').insert([{ tenant_id: tenantId }, { name: 'x' }])")[0].tenantId).toBe('missing')
    expect(scan("await db.from('store_orders').insert({ tenant_id: null })")[0].tenantId).toBe('missing')
    expect(scan("await db.from('store_orders').insert({ 'tenant_id': undefined })")[0].tenantId).toBe('missing')
  })

  it('marks a tenant_id taken from the request untrusted', () => {
    for (const value of ['body.tenant_id', "form.get('tenant_id')", 'params.tenant', 'ctx.params.tenant', '(await req.json()).tenant_id', "url.searchParams.get('t')"]) {
      expect(scan(`await db.from('store_orders').insert({ tenant_id: ${value} })`)[0].tenantId, value).toBe('untrusted')
    }
    expect(scan("const { tenantId } = await req.json()\nawait db.from('store_orders').insert({ tenant_id: tenantId })")[0].tenantId).toBe('untrusted')
    expect(scan("const { tenant_id } = await req.json()\nawait db.from('store_orders').insert({ tenant_id })")[0].tenantId).toBe('untrusted')
    expect(scan("await db.from('store_orders').insert([{ tenant_id: ctx.tenantId }, { tenant_id: body.t }])")[0].tenantId).toBe('untrusted')
  })

  it('a spread after tenant_id can overwrite it, so the row is indirect', () => {
    expect(scan("await db.from('store_orders').insert({ tenant_id: ctx.tenantId, ...row })")[0].tenantId).toBe('indirect')
  })

  it('a value it cannot judge is indirect, not explicit', () => {
    expect(scan("await db.from('store_orders').insert({ tenant_id: t })")[0].tenantId).toBe('indirect')
    expect(scan("await db.from('store_orders').insert({ tenant_id: other.value })")[0].tenantId).toBe('indirect')
    expect(scan("const { tenant_id } = row\nawait db.from('store_orders').insert({ tenant_id })")[0].tenantId).toBe('indirect')
  })

  it('marks a row it cannot read indirect', () => {
    expect(scan("await db.from('mentoring_cohorts').insert(row)")[0].tenantId).toBe('indirect')
    expect(scan("await db.from('refund_policies').insert({ ...row, scope: 'event' })")[0].tenantId).toBe('indirect')
    expect(scan("await db.from('community_resources').insert(rows as never)")[0].tenantId).toBe('indirect')
  })

  it('ignores reads, updates, other tables and other inserts', () => {
    expect(scan("await db.from('store_orders').select('id').eq('id', 1)")).toEqual([])
    expect(scan("await db.from('store_orders').update({ total: 2 }).eq('id', 1)")).toEqual([])
    expect(scan("await db.from('credentials').insert({ id: 1 })")).toEqual([])
    expect(scan("const s = new Set(); s.insert?.('store_orders')")).toEqual([])
  })

  it('reports the line, and follows a schema-qualified chain', () => {
    const [w] = optionalEventWrites('lib/x.ts', "const a = 1\nawait db.schema('public').from('store_orders')\n  .insert({ total: 1 })\n")
    expect(w).toMatchObject({ file: 'lib/x.ts', line: 2, table: 'store_orders', tenantId: 'missing' })
  })
})
