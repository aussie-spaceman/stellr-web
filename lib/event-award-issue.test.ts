import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/credentials-notify', () => ({ sendCredentialIssuedEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))

const { planAwardIssue } = await import('./event-award-issue')
import type { AssignmentRow } from './event-certificates'
import type { CredentialRow } from './credentials'

const assign = (participant_id: string, award_type: AssignmentRow['award_type']): AssignmentRow => ({
  id: `${participant_id}-${award_type}`, participant_id, award_type, company_id: 'co-1', assigned_at: '2026-10-03T00:00:00Z',
})

const cred = (participant_id: string, award_type: string, status: 'issued' | 'revoked' = 'issued') =>
  ({ id: `c-${participant_id}-${award_type}`, participant_id, award_type, status }) as CredentialRow

describe('planAwardIssue', () => {
  it('issues every assignment the first time', () => {
    const plan = planAwardIssue([assign('p1', 'overall_champion'), assign('p1', 'anita_gale')], [])
    expect(plan.toIssue).toHaveLength(2)
    expect(plan.toRevoke).toHaveLength(0)
  })

  it('changes nothing when the draft matches what is live', () => {
    const plan = planAwardIssue([assign('p1', 'anita_gale')], [cred('p1', 'anita_gale')])
    expect(plan.toIssue).toHaveLength(0)
    expect(plan.toRevoke).toHaveLength(0)
  })

  it('revokes an award moved to someone else, and issues the new one', () => {
    const plan = planAwardIssue([assign('p2', 'anita_gale')], [cred('p1', 'anita_gale')])
    expect(plan.toIssue.map((a) => a.participant_id)).toEqual(['p2'])
    expect(plan.toRevoke.map((c) => c.participant_id)).toEqual(['p1'])
  })

  it('re-issues an award given back after a revoke', () => {
    const plan = planAwardIssue([assign('p1', 'anita_gale')], [cred('p1', 'anita_gale', 'revoked')])
    expect(plan.toIssue).toHaveLength(1)
    expect(plan.toRevoke).toHaveLength(0)
  })
})
