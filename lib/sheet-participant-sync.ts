import type { SupabaseClient } from '@supabase/supabase-js'
import { readSheetParticipants } from '@/lib/google-sheets'
import { upsertMember } from '@/lib/member-sync'
import { normalizeEmail } from '@/lib/member-enums'
import { linkMembersToRegistrationSchool } from '@/lib/school-link'
import { recordEventParticipationForRegistration } from '@/lib/event-participation-sync'
import { dispatchAgreement } from '@/lib/docusign-agreements'
import { batchInvites } from '@/lib/esign/outbox'
import { isMinor } from '@/lib/docusign'
import { ensureIndividualPayments, type IndividualPaymentPerson } from '@/lib/individual-payment'
import { applyRosterChange } from '@/lib/group-billing'
import { stripeClient } from '@/lib/stripe'

export interface SheetSyncRegistration {
  id: string
  spreadsheet_id: string
  school_name: string | null
  event_slug: string
  event_title: string
  school_address_state?: string | null
}

export interface SheetSyncResult {
  created: number
  updated: number
  syncedMemberIds: string[]
  /** Individual payment links / free-event notices sent by this run. */
  paymentLinksSent: number
}

// A syntactically valid email, the gate for syncing a sheet row (INT-4). Kept
// deliberately simple — it only needs to reject blank and half-typed cells, not
// validate deliverability.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
function isSyncableEmail(email: string): boolean {
  return EMAIL_RE.test(email)
}

// Map the sheet's "Type" column to the members/participants enum role + bracket.
// Minors are always students (sheet people are never organisers).
function roleFromType(type: string, dateOfBirth: string | null): { eventRole: string; ageBracket: string } {
  const t = (type || '').trim().toLowerCase()
  const minor = dateOfBirth ? isMinor(dateOfBirth) : false
  let role =
    t === 'adult' ? 'adult' :
    t === 'mentor' ? 'mentor' :
    t === 'teacher' ? 'teacher' :
    'participant'
  if (minor) role = 'participant'
  return { eventRole: role, ageBracket: role === 'participant' ? 'high_school' : 'adult' }
}

// Reads the linked Google Sheet and upserts members + participants, then issues
// the correct DocuSign agreement for anyone who doesn't already have an envelope
// and — when the group pays individually — the payment link (or free-event "no
// payment required" notice) for anyone not yet told. So a person added via the
// sheet gets exactly the same paperwork AND billing flow as one added through
// the join link; previously they got the paperwork and nothing else, which left
// them unbilled and invisible to the webhook's "is the group paid?" check.
// Shared by the manual "Sync From Sheet" button and the Google-Drive change
// webhook so the two never drift. Non-fatal throughout.
export async function syncParticipantsFromSheet(
  db: SupabaseClient,
  registration: SheetSyncRegistration,
): Promise<SheetSyncResult> {
  // Stellr signing invitations go out together at the end, so a parent of
  // siblings on the sheet gets one email with a link for each child.
  return batchInvites(db, () => syncFromSheet(db, registration))
}

async function syncFromSheet(
  db: SupabaseClient,
  registration: SheetSyncRegistration,
): Promise<SheetSyncResult> {
  const sheetRows = await readSheetParticipants(registration.spreadsheet_id)

  let created = 0
  const createdPeople: { id: string; role: string }[] = []
  let updated = 0
  const syncedMemberIds: string[] = []
  const paymentPeople: IndividualPaymentPerson[] = []

  for (const row of sheetRows) {
    // Email is the cross-reference key for both the participant row and the
    // member record, so normalise it once here. Matching on the raw sheet value
    // was case-sensitive: "Jane@x.com" typed over an existing "jane@x.com" row
    // missed the match and added a duplicate participant.
    const email = normalizeEmail(row.email)

    // deep review INT-4: skip rows without a syntactically valid email. A Drive
    // push fires while the organiser is still typing a row, so a name-only row
    // used to sync with email='' — matching nothing, inserted as a phantom, and
    // then orphaned the moment the email was filled in (the email lookup no
    // longer matches the email-less row, so a SECOND participant is inserted).
    // Email is also the key for the member record and for routing consent/
    // payment, so a row without one cannot be processed meaningfully anyway.
    if (!isSyncableEmail(email)) continue

    const { data: existing } = await db
      .from('participants')
      .select('id')
      .eq('registration_id', registration.id)
      .or(
        row.membership_id
          ? `membership_id.eq.${row.membership_id},email.eq.${email}`
          : `email.eq.${email}`
      )
      .maybeSingle()

    const dob = row.date_of_birth || null
    const { eventRole, ageBracket } = roleFromType(row.type, dob)

    // Match against the existing membership database by email — an established
    // member is updated from this sheet row rather than duplicated — and create
    // one otherwise, so sheet-entered people get a member account, a school link,
    // and visibility on admin member pages. Blank cells never overwrite what's
    // already on file (see upsertMember). Non-fatal.
    const memberId = await upsertMember(db, {
      email,
      first_name: row.first_name,
      last_name: row.last_name,
      phone: row.phone,
      date_of_birth: dob,
      gender: row.gender,
      grade: row.grade || null,
      t_shirt_size: row.t_shirt_size,
      age_bracket: ageBracket,
      event_role: eventRole,
      health_conditions: row.health_conditions || null,
      ec_first_name: row.ec_first_name || null,
      ec_last_name: row.ec_last_name || null,
      ec_email: row.ec_email || null,
      ec_phone: row.ec_phone || null,
      ec_relationship: row.ec_relationship || null,
    })
    if (memberId) syncedMemberIds.push(memberId)

    const payload = {
      first_name: row.first_name,
      last_name: row.last_name,
      email,
      phone: row.phone,
      date_of_birth: dob,
      gender: row.gender,
      t_shirt_size: row.t_shirt_size,
      grade: row.grade || null,
      dietary_requirements: row.dietary_requirements,
      health_conditions: row.health_conditions || null,
      emergency_contact_first_name: row.ec_first_name || null,
      emergency_contact_last_name: row.ec_last_name || null,
      emergency_contact_email: row.ec_email || null,
      emergency_contact_phone: row.ec_phone || null,
      emergency_contact_relationship: row.ec_relationship || null,
      event_role: eventRole,
      age_bracket: ageBracket,
      school_name: registration.school_name ?? '',
      ...(memberId ? { member_id: memberId } : {}),
    }

    let participantId: string | null = null
    if (existing) {
      await db.from('participants').update(payload).eq('id', existing.id)
      participantId = existing.id
      updated++
    } else {
      const { data: inserted, error: insErr } = await db
        .from('participants')
        .insert({ ...payload, registration_id: registration.id })
        .select('id')
        .single()
      if (insErr) {
        // deep review INT-4: two overlapping Drive pushes run two full syncs at
        // once; both read "no participant" and both try to insert the same
        // (registration_id, lower(email)). The participants_reg_email_uniq index
        // (migration 20261012165038) makes the loser fail — treat that as "the
        // other sync already created it", re-read the row, and update it so we
        // don't manufacture a duplicate / a second consent + payment dispatch.
        const { data: raced } = await db
          .from('participants')
          .select('id')
          .eq('registration_id', registration.id)
          .eq('email', email)
          .maybeSingle()
        if (raced?.id) {
          await db.from('participants').update(payload).eq('id', raced.id)
          participantId = raced.id
          updated++
        } else {
          console.error('[sheet-sync] participant insert failed:', insErr.message)
        }
      } else {
        participantId = inserted?.id ?? null
        created++
        if (participantId) createdPeople.push({ id: participantId, role: eventRole })
      }
    }

    // Paperwork, then billing. dispatchAgreement is a no-op for anyone who
    // already has an envelope for this participant or valid signed paperwork on
    // file, so a re-sync never re-sends — that dedupe used to be duplicated here
    // and now lives inside dispatchAgreement, where every caller gets it.
    if (participantId) {
      await dispatchAgreement(db, {
        participantId,
        memberId,
        eventSlug:         registration.event_slug,
        eventTitle:        registration.event_title,
        firstName:         row.first_name,
        lastName:          row.last_name,
        email,
        phone:             row.phone,
        dateOfBirth:       dob,
        eventRole,
        schoolName:        registration.school_name ?? undefined,
        schoolState:       registration.school_address_state ?? undefined,
        guardianFirstName: row.ec_first_name || undefined,
        guardianLastName:  row.ec_last_name || undefined,
        guardianEmail:     row.ec_email || undefined,
        guardianPhone:     row.ec_phone || undefined,
        relationship:      row.ec_relationship || undefined,
        grade:             row.grade || undefined,
      })
      // Everyone on the sheet, not just this run's new rows: the helper skips
      // anyone already emailed, so people entered before this existed are picked
      // up on the next sync instead of staying permanently unbilled.
      paymentPeople.push({
        participantId,
        email,
        firstName: row.first_name,
        lastName:  row.last_name,
      })
    }
  }

  // Link every synced member to the group's school, and record the event in
  // each one's Event Activity (event_participations).
  await linkMembersToRegistrationSchool(db, registration.id, syncedMemberIds)
  await recordEventParticipationForRegistration(db, registration.id, syncedMemberIds)

  // Individual payment links (or free-event notices) for a group whose members
  // pay their own way. No-op for any other payment method, and for anyone
  // already notified on an earlier sync.
  const { charged, waived } = await ensureIndividualPayments(db, registration.id, paymentPeople)

  // New people beyond the group's places grow it: an unpaid invoice is revised,
  // a paid group is invoiced for the extra places (lib/group-billing.ts). One
  // call for the whole sync, so the organiser gets one invoice, not one each.
  if (createdPeople.length > 0) {
    await applyRosterChange(db, stripeClient(), {
      registrationId: registration.id,
      change: { kind: 'added', count: createdPeople.length },
      eventRole: createdPeople[0].role,
      addedRoles: createdPeople.map((p) => p.role),
      participantIds: createdPeople.map((p) => p.id),
      actor: { memberId: null, label: 'sheet sync' },
    }).catch((err) => console.error('[sheet-sync] billing update failed:', err))
  }

  return { created, updated, syncedMemberIds, paymentLinksSent: charged + waived }
}
