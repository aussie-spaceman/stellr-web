// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rankEvents, eventUrls } from './lighthouse-urls'
import { formatRow, formatReport } from './lighthouse-summary'

describe('rankEvents', () => {
  const today = '2026-11-05'

  it('prefers upcoming events with registration open, soonest first', () => {
    expect(
      rankEvents(
        [
          { slug: 'later-open', date: '2027-03-01', registrationOpen: true },
          { slug: 'soon-closed', date: '2026-11-06', registrationOpen: false },
          { slug: 'soon-open', date: '2026-11-24', registrationOpen: true },
          { slug: 'past', date: '2026-10-03', registrationOpen: true },
        ],
        today,
      ),
    ).toEqual(['soon-open', 'later-open', 'soon-closed', 'past'])
  })

  it('counts an event as upcoming through its last day', () => {
    expect(
      rankEvents(
        [
          { slug: 'recent', date: '2026-11-04' },
          { slug: 'running', date: '2026-11-03', endDate: '2026-11-05' },
        ],
        today,
      ),
    ).toEqual(['running', 'recent'])
  })

  it('still offers something when every event is in the past, newest first', () => {
    expect(
      rankEvents(
        [
          { slug: 'old', date: '2025-01-01' },
          { slug: 'newer', date: '2026-01-01' },
        ],
        today,
      ),
    ).toEqual(['newer', 'old'])
  })

  it('returns nothing for no events', () => {
    expect(rankEvents([], today)).toEqual([])
  })
})

describe('eventUrls', () => {
  it('names the detail and registration pages', () => {
    expect(eventUrls('http://localhost:3000', 'a')).toEqual([
      'http://localhost:3000/events/a',
      'http://localhost:3000/register/a/individual',
    ])
  })
})

describe('the summary', () => {
  it('turns scores into percentages and metrics into readable values', () => {
    const row = formatRow(
      {
        url: 'http://localhost:3000/events/a',
        summary: { performance: 0.876, accessibility: 1, 'best-practices': 0.9 },
      },
      {
        'largest-contentful-paint': { numericValue: 2510.4 },
        'total-blocking-time': { numericValue: 120 },
        'cumulative-layout-shift': { numericValue: 0.0123 },
      },
    )
    expect(row).toBe('/events/a | 88 | 100 | 90 | 2510 ms | 120 ms | 0.012')
  })

  it('shows a dash for a score or metric lhci did not produce', () => {
    expect(formatRow({ url: 'http://localhost:3000/', summary: { performance: null } })).toBe('/ | – | – | – | – | – | –')
  })

  it('renders a markdown table', () => {
    expect(formatReport(['/ | 1 | 2 | 3 | 4 | 5 | 6']).split('\n')).toHaveLength(3)
  })
})

describe('the CI lighthouse job', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
  const start = ci.indexOf('\n  lighthouse:\n')
  const job = ci.slice(start, ci.indexOf('\n  db:\n', start))

  it('stays report-only', () => {
    const step = job.slice(job.indexOf('name: Lighthouse (mobile, report-only)'))
    expect(step.slice(0, step.indexOf('run:'))).toContain('continue-on-error: true')
  })

  it('gives the build the CMS, or every event page 404s', () => {
    expect(job.indexOf('NEXT_PUBLIC_SANITY_PROJECT_ID=')).toBeGreaterThan(-1)
    expect(job.indexOf('NEXT_PUBLIC_SANITY_PROJECT_ID=')).toBeLessThan(job.indexOf('run: npm run build'))
  })

  it('names no event in the static URL list', () => {
    const rc = JSON.parse(readFileSync('lighthouserc.json', 'utf8'))
    const urls: string[] = rc.ci.collect.url
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter((u) => /\/(events|register)\//.test(u))).toEqual([])
  })
})
