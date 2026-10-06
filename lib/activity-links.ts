// Where an activity-log entry links to, if anywhere. The timeline is shared by
// the member's own account and the admin member page, so the same entry opens
// a different page for each; the page rendering it says which it is.

export type ActivityAudience = { audience: 'member' } | { audience: 'admin'; memberId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function activityHref(
  item: { category: string; metadata: Record<string, unknown> | null },
  to: ActivityAudience | undefined,
): string | null {
  if (!to) return null
  if (item.category === 'survey') {
    const id = item.metadata?.response_id
    if (typeof id !== 'string' || !UUID.test(id)) return null
    return to.audience === 'admin' ? adminSurveyResponseHref(to.memberId, id) : `/community/surveys/${id}`
  }
  return null
}

export function adminSurveyResponseHref(memberId: string, responseId: string): string {
  return `/admin/members/${memberId}/surveys/${responseId}`
}
