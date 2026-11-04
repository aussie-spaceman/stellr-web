// @vitest-environment node
//
// The backup scripts in ops/backups/ run in the owner's private backups repo
// and on the owner's machine for restore drills, where a silent bug means a
// backup nobody can restore. These tests pin the two pieces of logic a drill's
// verdict rests on (the table fingerprint and the manifest comparison), that
// the hourly table list still names real tables, and that every workflow in
// this lane pins its actions to a commit SHA.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FINGERPRINT = 'ops/backups/fingerprint.sh'
const COMPARE = 'ops/backups/compare-manifests.sh'

function fingerprint(sql: string) {
  const r = spawnSync('bash', [FINGERPRINT, '--sql', '-'], { input: sql, encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  return r.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'))
}

const dump = (memberRows: string[], creditRows: string[] = []) =>
  [
    '-- PostgreSQL database dump',
    "SET client_encoding = 'UTF8';",
    'COPY public.members (id, first_name, created_at) FROM stdin;',
    ...memberRows,
    '\\.',
    '',
    'COPY entitlements.account_credit_ledger (id, amount) FROM stdin;',
    ...creditRows,
    '\\.',
    '',
    "SELECT pg_catalog.setval('public.members_id_seq', 3, true);",
  ].join('\n')

describe('ops/backups/fingerprint.sh', () => {
  const rows = ['1\tAda\t2026-11-03 00:00:00+00', '2\tGrace\t2026-11-03 01:00:00+00', '3\t\\N\t2026-11-03 02:00:00+00']

  it('lists every table, sorted, with its row count, including empty ones', () => {
    const out = fingerprint(dump(rows))
    expect(out.map(([t, n]) => [t, n])).toEqual([
      ['entitlements.account_credit_ledger', '0'],
      ['public.members', '3'],
    ])
    for (const [, , hash] of out) expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('does not depend on row order (a restore does not preserve it)', () => {
    const a = fingerprint(dump(rows))
    const b = fingerprint(dump([...rows].reverse()))
    expect(b).toEqual(a)
  })

  it('changes the hash when one value changes, and the count when a row is lost', () => {
    const base = fingerprint(dump(rows))
    const edited = fingerprint(dump([rows[0], rows[1].replace('Grace', 'Grac3'), rows[2]]))
    const lost = fingerprint(dump(rows.slice(0, 2)))
    const members = (m: string[][]) => m.find(([t]) => t === 'public.members')!
    expect(members(edited)[1]).toBe('3')
    expect(members(edited)[2]).not.toBe(members(base)[2])
    expect(members(lost)[1]).toBe('2')
  })

  it('ignores everything outside COPY blocks', () => {
    const a = fingerprint(dump(rows))
    const b = fingerprint(dump(rows).replace("setval('public.members_id_seq', 3", "setval('public.members_id_seq', 99"))
    expect(b).toEqual(a)
  })

  it('prints nothing for a dump with no data', () => {
    expect(fingerprint('SET client_encoding = \'UTF8\';\n')).toEqual([])
  })
})

describe('ops/backups/compare-manifests.sh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'compare-manifests-'))
  const H1 = 'a'.repeat(64)
  const H2 = 'b'.repeat(64)
  const write = (name: string, lines: string[]) => {
    const p = join(dir, name)
    writeFileSync(p, lines.map((l) => l + '\n').join(''))
    return p
  }
  const run = (expected: string[], actual: string[]) => {
    const r = spawnSync('bash', [COMPARE, write('e.tsv', expected), write('a.tsv', actual)], { encoding: 'utf8' })
    return { status: r.status, out: r.stdout }
  }

  it('passes when every table matches', () => {
    const m = [`public.members\t3\t${H1}`, `public.registrations\t5\t${H2}`]
    const { status, out } = run(m, [...m].reverse())
    expect(status).toBe(0)
    expect(out).toContain('PASS: 2 of 2 tables match (8 rows)')
  })

  it.each([
    ['ROWS', [`public.members\t2\t${H1}`], 'expected 3, restored 2'],
    ['HASH', [`public.members\t3\t${H2}`], 'same 3 rows, different content'],
    ['MISSING', [], 'in the backup, not restored'],
  ])('fails on %s', (label, actual, detail) => {
    const { status, out } = run([`public.members\t3\t${H1}`], actual)
    expect(status).toBe(1)
    expect(out).toMatch(new RegExp(`^${label} +public\\.members +${detail}`, 'm'))
    expect(out).toContain('FAIL:')
  })

  it('fails on a table restored that the backup never had', () => {
    const { status, out } = run([`public.members\t3\t${H1}`], [`public.members\t3\t${H1}`, `public.extra\t1\t${H2}`])
    expect(status).toBe(1)
    expect(out).toMatch(/^EXTRA +public\.extra/m)
  })

  it('fails when both manifests are empty rather than passing vacuously', () => {
    const { status, out } = run([], [])
    expect(status).toBe(1)
    expect(out).toContain('FAIL: both manifests are empty')
  })
})

describe('ops/backups/critical-tables.txt', () => {
  it('names only tables that exist in the schema (pg_dump runs with --strict-names)', () => {
    const schema = [
      readFileSync('supabase/baseline.sql', 'utf8'),
      ...readdirSync('supabase/migrations')
        .filter((f) => f.endsWith('.sql'))
        .map((f) => readFileSync(join('supabase/migrations', f), 'utf8')),
    ].join('\n')
    // Replay CREATE / RENAME / DROP in file order, so a renamed table (the
    // docusign_* → agreements rename, 2 Oct 2026) counts under its new name only.
    const created = new Set<string>()
    const ddl =
      /create table (?:if not exists )?"?([a-z_]+)"?\."?([a-z_]+)"?|alter table (?:if exists )?"?([a-z_]+)"?\."?([a-z_]+)"? rename to "?([a-z_]+)"?|drop table (?:if exists )?"?([a-z_]+)"?\."?([a-z_]+)"?/gi
    for (const m of schema.matchAll(ddl)) {
      const [, cs, ct, rs, rt, rnew, ds, dt] = m.map((s) => s?.toLowerCase())
      if (cs) created.add(`${cs}.${ct}`)
      else if (rs) { created.delete(`${rs}.${rt}`); created.add(`${rs}.${rnew}`) }
      else if (ds) created.delete(`${ds}.${dt}`)
    }
    const listed = readFileSync('ops/backups/critical-tables.txt', 'utf8')
      .split('\n')
      .map((l) => l.replace(/#.*/, '').trim())
      .filter(Boolean)
    expect(listed.length).toBeGreaterThan(20)
    expect(listed.filter((t) => !created.has(t))).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })
})

describe('shell in this lane parses', () => {
  const bashSyntax = (script: string) => spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' })

  it.each(readdirSync('ops/backups').filter((f) => f.endsWith('.sh')))('ops/backups/%s', (f) => {
    const r = bashSyntax(readFileSync(join('ops/backups', f), 'utf8'))
    expect(r.status, r.stderr).toBe(0)
  })

  // Every `run:` block, with GitHub expressions replaced, through `bash -n`.
  function runBlocks(file: string): string[] {
    const lines = readFileSync(file, 'utf8').split('\n')
    const blocks: string[] = []
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)(?:- )?run: (.*)$/)
      if (!m) continue
      if (m[2].trim() !== '|') { blocks.push(m[2]); continue }
      const body: string[] = []
      let indent = -1
      for (i++; i < lines.length; i++) {
        const l = lines[i]
        const lead = l.match(/^\s*/)![0].length
        if (l.trim() && lead <= m[1].length) { i--; break }
        if (indent < 0 && l.trim()) indent = lead
        body.push(l.slice(Math.max(indent, 0)))
      }
      blocks.push(body.join('\n'))
    }
    return blocks.map((b) => b.replace(/\$\{\{[^}]*\}\}/g, 'X'))
  }

  it.each(['ops/backups/workflow.yml', '.github/workflows/prod-migrate.yml'])('run blocks in %s', (file) => {
    const blocks = runBlocks(file)
    expect(blocks.length).toBeGreaterThan(2)
    for (const b of blocks) {
      const r = bashSyntax(b)
      expect(r.status, `${r.stderr}\n---\n${b}`).toBe(0)
    }
  })
})

describe('workflows in this lane pin actions to commit SHAs', () => {
  it.each(['ops/backups/workflow.yml', '.github/workflows/prod-migrate.yml'])('%s', (file) => {
    const uses = [...readFileSync(file, 'utf8').matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(0)
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
  })
})
