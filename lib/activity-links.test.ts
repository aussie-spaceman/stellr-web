import { describe, expect, it } from 'vitest'
import { activityHref, adminSurveyResponseHref } from './activity-links'

const RESPONSE = '0b6d2c1e-6f0a-4a57-9d1e-2b4f8c3a9e10'
const MEMBER = '5f1c9a7e-2d3b-4c8a-b1e6-7a9d0c2f4e31'
const survey = (metadata: Record<string, unknown> | null) => ({ category: 'survey', metadata })

describe('activity entry links', () => {
  it('opens a survey response on the member’s own page', () => {
    expect(activityHref(survey({ response_id: RESPONSE }), { audience: 'member' })).toBe(`/community/surveys/${RESPONSE}`)
  })

  it('opens the admin response page for an admin', () => {
    expect(activityHref(survey({ response_id: RESPONSE }), { audience: 'admin', memberId: MEMBER })).toBe(
      `/admin/members/${MEMBER}/surveys/${RESPONSE}`,
    )
    expect(adminSurveyResponseHref(MEMBER, RESPONSE)).toBe(`/admin/members/${MEMBER}/surveys/${RESPONSE}`)
  })

  it('links nothing without a valid response id (an invitation entry, bad metadata)', () => {
    expect(activityHref(survey({ invitation_id: RESPONSE }), { audience: 'member' })).toBeNull()
    expect(activityHref(survey({ response_id: '../../admin' }), { audience: 'member' })).toBeNull()
    expect(activityHref(survey(null), { audience: 'member' })).toBeNull()
  })

  it('leaves other categories and unconfigured timelines unlinked', () => {
    expect(activityHref({ category: 'event', metadata: { response_id: RESPONSE } }, { audience: 'member' })).toBeNull()
    expect(activityHref(survey({ response_id: RESPONSE }), undefined)).toBeNull()
  })
})
