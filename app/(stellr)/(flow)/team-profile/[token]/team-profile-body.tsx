import type { ProfileSession } from '@/lib/team-profile/store'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { SurveyNotice } from '@/components/survey/SurveyNotice'
import { TeamProfileForm } from '@/components/team-profile/TeamProfileForm'

// The emailed team profile link's page body, shared by Stellr's page and the tenant's.
// Each page reads its own session and passes it in, so this file reads nothing.
//
// A page shows only its own tenant's links (S5 A10a): Stellr's page passes
// onlyTenant(STELLR_TENANT_ID) to sessionByToken, so another tenant's link answers as
// one nobody holds straight after the row is read, and its student, event and answers
// are never shown. A NULL tenant is a Stellr row the backfill has not reached. The
// check is a constant: no request is read.

/** sessionByToken's onHost for a page whose tenant is `tenantId`. */
export function onlyTenant(tenantId: string) {
  return async (row: { tenant_id: string | null }) => (row.tenant_id ?? STELLR_TENANT_ID) === tenantId
}

export function TeamProfileBody({ token, session }: { token: string; session: ProfileSession | null }) {
  if (!session) {
    return (
      <SurveyNotice eyebrow="Team profile" title="This link isn’t valid">
        <p>Check you used the whole link from your email. If it still doesn’t work, reply to the email and we’ll send a new one.</p>
      </SurveyNotice>
    )
  }
  if (!session.open) {
    return (
      <SurveyNotice eyebrow="Team profile" title="Team profiles are closed">
        <p>{session.eventTitle} has started, so answers can’t be changed now. See you there!</p>
      </SurveyNotice>
    )
  }
  return (
    <div className="bg-surface px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <TeamProfileForm
          token={token}
          initial={session.answers}
          studentFirstName={session.studentFirstName}
          eventTitle={session.eventTitle}
          prefilled={session.prefilled}
          submitted={!!session.row.submitted_at}
        />
      </div>
    </div>
  )
}
