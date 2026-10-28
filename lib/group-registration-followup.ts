import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchAgreement, type ParticipantContext } from '@/lib/docusign-agreements'
import { batchInvites } from '@/lib/esign/outbox'
import { sendGroupAccountInvite } from '@/lib/member-invite'
import { notifyClearanceRequired } from '@/lib/compliance-notify'
import { requiresBackgroundCheck } from '@/lib/compliance'

// Everything a group registration owes its people once the organiser has their
// answer: an agreement each, a login each, and a clearance notice for the
// organiser. It runs after the response (runAfterResponse) because it is slow —
// one DocuSign envelope takes ~5 s, so a team of 18 took longer than the old
// 60 s request budget and the request was killed mid-loop, leaving half the team
// with no agreement and the invoice, sheet and confirmation email never sent
// (28 Oct 2026). Work that does not fit before `deadline` is left for the daily
// sweeps (lib/esign/reconcile issueMissingAgreements, lib/group-account-invites),
// so a large team finishes overnight instead of being cut off.

export interface FollowUpPerson {
  /** The agreement context, exactly as the registration route built it. */
  agreement: ParticipantContext & { participantId: string }
  /** The organiser is already signed in; they get the clearance notice instead of an invite. */
  isRegistrant: boolean
}

export interface GroupFollowUpInput {
  eventSlug: string
  eventTitle: string
  eventDate?: string | null
  organiserName: string
  people: FollowUpPerson[]
  /** Epoch ms after which no new slow work is started. */
  deadline: number
}

export interface GroupFollowUpResult {
  clearance: string
  agreements: Record<string, number>
  invites: Record<string, number>
  deferred: { agreements: number; invites: number }
}

export async function runGroupRegistrationFollowUp(
  db: SupabaseClient,
  input: GroupFollowUpInput,
): Promise<GroupFollowUpResult> {
  const outOfTime = () => Date.now() > input.deadline
  const result: GroupFollowUpResult = {
    clearance: 'skipped',
    agreements: {},
    invites: {},
    deferred: { agreements: 0, invites: 0 },
  }
  const bump = (bucket: Record<string, number>, key: string) => { bucket[key] = (bucket[key] ?? 0) + 1 }

  // 1. Clearance notices first — one email per adult, and a long roster must
  //    never starve them. notifyClearanceRequired is a no-op for anyone already
  //    cleared or not required (students), and sends at most once per event.
  const adults = input.people.filter(
    (p) => p.agreement.memberId && requiresBackgroundCheck(p.agreement.eventRole ?? null, p.agreement.dateOfBirth ?? null),
  )
  const clearance: Record<string, number> = {}
  for (const person of adults) {
    try {
      const r = await notifyClearanceRequired(db, {
        memberId: person.agreement.memberId as string,
        eventSlug: input.eventSlug,
        eventTitle: input.eventTitle,
        eventDate: input.eventDate ?? null,
        reason: 'registered',
      })
      bump(clearance, r.sent ? 'sent' : r.reason)
    } catch (err) {
      bump(clearance, 'error')
      console.error('[group-followup] clearance notice failed:', err)
    }
  }
  result.clearance = Object.entries(clearance).map(([k, n]) => `${k}:${n}`).join(',') || 'none'

  // 2. Agreements, one at a time (DocuSign rate limits; siblings' Stellr
  //    invitations are bundled by batchInvites). dispatchAgreement never throws.
  await batchInvites(db, async () => {
    for (const person of input.people) {
      if (outOfTime()) { result.deferred.agreements++; continue }
      bump(result.agreements, await dispatchAgreement(db, person.agreement))
    }
  })

  // 3. Logins for everyone but the organiser.
  for (const person of input.people) {
    if (person.isRegistrant || !person.agreement.memberId) continue
    if (outOfTime()) { result.deferred.invites++; continue }
    try {
      const r = await sendGroupAccountInvite(db, person.agreement.memberId, {
        eventTitle: input.eventTitle,
        organiserName: input.organiserName,
      })
      bump(result.invites, r.sent ? 'sent' : r.reason)
    } catch (err) {
      bump(result.invites, 'error')
      console.error('[group-followup] account invite failed:', err)
    }
  }

  return result
}
