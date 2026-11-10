// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

// deep review QUAL-7: the three money/minors handlers run long, sequential
// fan-outs (per-participant consent dispatch, Google Sheets, Stripe). Each must
// pin an explicit maxDuration so a large registration or a slow webhook is not
// cut off by the lower platform default mid-flow (envelopes issued, invoice
// unsent). NB: this is the SAFE part of QUAL-7 — extracting the 500–1000-line
// handlers is deliberately NOT done here (regression risk on just-shipped fixes)
// and is flagged as a follow-up.
describe('long route handlers declare maxDuration (QUAL-7)', () => {
  for (const f of [
    'app/api/register/group/route.ts',
    'app/api/register/individual/route.ts',
    'app/api/stripe/webhook/route.ts',
  ]) {
    it(`${f} exports a maxDuration`, () => {
      expect(readFileSync(f, 'utf8')).toMatch(/export const maxDuration = \d+/)
    })
  }
})

// S5 B11: the runner's per-tenant slices need each cron's limit. A cron cut short
// mid-batch loses its run.finish, so a limit here may only rise: these are the
// values at the sweep, and anything lower needs run times that justify it.
const CRON_FLOORS: Record<string, number> = {
  'alumni-upgrades': 300,
  'apollo-reconcile': 60,
  'background-sync': 60,
  'campaign-drip': 300,
  'campaign-events': 300,
  campaigns: 60,
  'deletion-archive-retention': 60,
  'docusign-form-data': 300,
  'docusign-reminders': 300,
  entitlements: 300,
  'email-outbox': 60,
  'event-emails': 60,
  'group-invoice-sync': 300,
  'hubspot-event-options': 300,
  'hubspot-lifecycle': 300,
  'lead-capture-failures': 300,
  'membership-expiry': 60,
  'motion-bookings': 300,
  'session-reminders': 300,
  'survey-retention': 60,
  surveys: 60,
  'team-profiles': 60,
  'training-reminders': 300,
  'weekly-digest': 60,
}

/** Hobby's limit for a function. A build fails above it, so the sweep cannot aim higher. */
const HOBBY_MAX_SECONDS = 300

const cronSource = (job: string) => readFileSync(`app/api/cron/${job}/route.ts`, 'utf8')
const declaredSeconds = (job: string) => Number(/^export const maxDuration = (\d+)$/m.exec(cronSource(job))?.[1])
const budgetMs = (job: string, name: string) => {
  const raw = new RegExp(`^const ${name} = ([\\d_]+)$`, 'm').exec(cronSource(job))?.[1]
  return Number(raw?.replaceAll('_', ''))
}

describe('every cron declares a maxDuration (S5 B11)', () => {
  const jobs = readdirSync('app/api/cron', { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()

  it('has a floor for exactly the cron routes', () => {
    expect(Object.keys(CRON_FLOORS).sort()).toEqual(jobs)
  })

  for (const job of jobs) {
    it(`${job} stays at or above its floor and within the plan`, () => {
      const seconds = declaredSeconds(job)
      expect(seconds).toBeGreaterThanOrEqual(CRON_FLOORS[job])
      expect(seconds).toBeLessThanOrEqual(HOBBY_MAX_SECONDS)
    })
  }

  // Each stops starting work at its budget and still has work after it, so the
  // limit has to clear the budget, not just equal it.
  for (const [job, name] of [
    ['docusign-reminders', 'CHASE_BUDGET_MS'],
    ['docusign-form-data', 'READ_BUDGET_MS'],
    ['apollo-reconcile', 'RUN_BUDGET_MS'],
    ['background-sync', 'REMINDER_BUDGET_MS'],
  ] as const) {
    it(`${job} leaves room after ${name} for what follows it`, () => {
      const budget = budgetMs(job, name)
      expect(budget).toBeGreaterThan(0)
      expect(declaredSeconds(job) * 1000 - budget).toBeGreaterThanOrEqual(15_000)
    })
  }

  it('apollo-reconcile still resumes from its nextOffset cursor', () => {
    const source = cronSource('apollo-reconcile')
    expect(source).toContain("typeof previous?.nextOffset === 'number'")
    expect(source).toContain('run.finish({ nextOffset')
  })
})
