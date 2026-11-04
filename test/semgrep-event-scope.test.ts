// @vitest-environment node
//
// .semgrep/event-scope.yml (S2) lists the event-scoped tables whose queries
// need an event filter. lib/tenancy/registry.ts (S3) is the source of truth
// for which tables are event-scoped. This keeps the Semgrep list from falling
// behind the registry: every table the registry keys by event_slug must be in
// the rule's table regex, so a new event table is on the S5 worklist the day it
// lands. (Tables keyed by a Sanity id — event_ref / sanity_event_id — are not
// covered: the rule only recognises event_slug / event_id filters.)
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'

const ROOT = join(__dirname, '..')
const RULE = readFileSync(join(ROOT, '.semgrep/event-scope.yml'), 'utf8')

function ruleTables(): string[] {
  const m = RULE.match(/regex: \^\(([^)]+)\)\$/)
  if (!m) throw new Error('event-scope.yml: table regex not found')
  return m[1].split('|')
}

describe('.semgrep/event-scope.yml follows lib/tenancy/registry.ts', () => {
  const listed = ruleTables()

  it('reads the table list', () => {
    expect(listed.length).toBeGreaterThan(20)
  })

  it('lists every public table the registry keys by event_slug', () => {
    const slugTables = Object.entries(TABLE_REGISTRY)
      .filter(([name, e]) => name.startsWith('public.') && e.eventKey?.column === 'event_slug')
      .map(([name]) => name.slice('public.'.length))
    const missing = slugTables.filter((t) => !listed.includes(t))
    expect(missing).toEqual([])
  })
})
