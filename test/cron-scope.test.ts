import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { CRON_SCOPES } from '@/lib/cron-scope'

// Every cron is classified, and only real crons are. A new cron cannot reach
// production without someone deciding what it may touch on a second tenant.

const routes = readdirSync('app/api/cron', { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()

const schedules = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }).crons
const scheduled = [...new Set(schedules.map((c) => c.path.replace('/api/cron/', '')))].sort()

function withScope(scope: string) {
  return Object.entries(CRON_SCOPES)
    .filter(([, v]) => v.scope === scope)
    .map(([job]) => job)
    .sort()
}

describe('cron scope', () => {
  it('covers exactly the cron routes and the vercel.json schedules', () => {
    expect(routes).toHaveLength(24)
    expect(schedules).toHaveLength(32)
    expect(scheduled).toEqual(routes)
    expect(Object.keys(CRON_SCOPES).sort()).toEqual(routes)
  })

  it('names the crons that move onto the per-tenant runner', () => {
    expect(withScope('per_tenant')).toEqual([
      'docusign-reminders',
      'event-emails',
      'group-invoice-sync',
      'survey-retention',
      'surveys',
      'team-profiles',
    ])
  })

  it('keeps the crons that read event data for Stellr off the per-tenant list', () => {
    const stellrOnly = withScope('stellr_only')
    for (const job of [
      'background-sync',
      'docusign-form-data',
      'hubspot-event-options',
      'membership-expiry',
      'training-reminders',
      'weekly-digest',
    ]) {
      expect(stellrOnly).toContain(job)
    }
  })

  it('names the Stellr-only crons that pick people from the shared members table', () => {
    const named = Object.entries(CRON_SCOPES)
      .filter(([, v]) => v.identityAudience)
      .map(([job]) => job)
      .sort()
    expect(named).toEqual(['alumni-upgrades', 'campaign-drip', 'campaign-events', 'campaigns'])
    for (const job of named) expect(CRON_SCOPES[job].scope, job).toBe('stellr_only')
  })

  it('names the Stellr-only crons whose other members reads stay as wide as today', () => {
    const named = Object.entries(CRON_SCOPES)
      .filter(([, v]) => v.identityRead)
      .map(([job]) => job)
      .sort()
    expect(named).toEqual(['membership-expiry', 'weekly-digest'])
  })

  it('keeps retention running for tenants that are not active, and only retention', () => {
    const named = Object.entries(CRON_SCOPES)
      .filter(([, v]) => v.inactiveTenants === 'run')
      .map(([job]) => job)
    expect(named).toEqual(['survey-retention'])
  })

  it('gives a reason for every classification', () => {
    for (const [job, v] of Object.entries(CRON_SCOPES)) expect(v.why.length, job).toBeGreaterThan(0)
  })
})
