// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS, isCataloguedAction } from './actions'

// The action CHECK on platform_audit_events, from the migration that defines it,
// so a catalogued name can never be one the database would refuse.
const dir = 'supabase/migrations'
const defining = readdirSync(dir).find((f) => f.endsWith('_platform_audit_events.sql'))
const sql = readFileSync(path.join(dir, defining as string), 'utf8')
const shape = sql.match(/action ~ '([^']+)'/)?.[1] as string

describe('the audit action catalogue', () => {
  it('read the shape from the migration', () => {
    expect(shape).toContain('[a-z]')
  })

  it('every action is one the table accepts', () => {
    const re = new RegExp(shape)
    for (const a of AUDIT_ACTIONS) {
      expect(a.length, a).toBeLessThanOrEqual(100)
      expect(re.test(a), a).toBe(true)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length)
  })

  it('tells a catalogued name from any other', () => {
    expect(isCataloguedAction('support.impersonate.start')).toBe(true)
    expect(isCataloguedAction('support.impersonate')).toBe(false)
    expect(isCataloguedAction('')).toBe(false)
  })
})
