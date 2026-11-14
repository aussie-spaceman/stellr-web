import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { watchSheet, isGoogleSheetsConfigured } from '@/lib/google-sheets'
import { ownsTeam } from '@/lib/team-access'
import { SHEET_SYNC_COLUMNS, SheetSyncRefused, syncParticipantsFromSheet } from '@/lib/sheet-participant-sync'
import { randomBytes, randomUUID } from 'crypto'
import { assertNotImpersonating } from '@/lib/impersonation'
import { withAudit } from '@/lib/audit/route'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { rowTenant } from '@/lib/registration/event-context'
import { teamAudit, TEAM_SHEET_SYNC_AUDIT } from '@/lib/registration/team-audit'

// A roster change waits out the group invoice quiet period after responding
// (lib/group-billing.ts), and that wait has to fit inside the function.
export const maxDuration = 300

// POST /api/members/teams/[id]/sheet-sync
// Reads the linked Google Sheet and upserts participant records.
// Also registers a push notification channel if one isn't active.
//
// S5 A8: only a group of this host's tenant (another tenant's answers as missing), and
// audited behind PLATFORM_AUDIT_ENABLED on the group's tenant's chain.
export const POST = withAudit(TEAM_SHEET_SYNC_AUDIT, syncSheet)

async function syncSheet(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: registrationId } = await params
  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db
    .from('registrations')
    .select(`teacher_member_id, teacher_email, teacher_poc_email, ${SHEET_SYNC_COLUMNS}`)
    .eq('id', registrationId)
    .eq('type', 'group')
    .maybeSingle()

  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (rowTenant(registration.tenant_id) !== (await requestTenant()).tenantId) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  }
  // Ownership by member id OR registrant email OR nominated teacher-POC email
  // (see lib/team-access).
  if (!ownsTeam(member, registration)) {
    console.warn('[teams/sheet-sync] Access denied', { registrationId, memberId: member.id })
    return NextResponse.json({ error: 'You do not have access to this team' }, { status: 403 })
  }
  teamAudit(req, { registrationId, tenantId: rowTenant(registration.tenant_id), userId })
  if (!registration.spreadsheet_id) return NextResponse.json({ error: 'No spreadsheet linked to this team' }, { status: 400 })

  if (!isGoogleSheetsConfigured()) {
    return NextResponse.json({ error: 'Google Sheets not configured' }, { status: 503 })
  }

  // Upsert members + participants, issue DocuSign for anyone missing it, and —
  // for an individually-paid group — send each new person their payment link or
  // free-event notice (shared with the Google-Drive webhook so the two paths
  // never drift).
  let synced: Awaited<ReturnType<typeof syncParticipantsFromSheet>>
  try {
    synced = await syncParticipantsFromSheet(db, registration)
  } catch (e) {
    if (e instanceof SheetSyncRefused) return NextResponse.json(e.body, { status: e.status })
    throw e
  }
  const { created, updated, paymentLinksSent, skippedForDateOfBirth } = synced

  // Register watch channel if not already active
  let watchActive = false
  const { data: existingChannel } = await db
    .from('sheet_watch_channels')
    .select('expiration')
    .eq('registration_id', registrationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A new channel (first sync, or renewal once the last one expired) always carries a
  // fresh random token: Google sends it back in X-Goog-Channel-Token and the webhook
  // refuses a notification without it (threat model §6.11). Channels registered
  // before tokens existed have none and are honoured only until they expire, so the
  // first sync after that re-registers the sheet with a token.
  if (!existingChannel || new Date(existingChannel.expiration) <= new Date()) {
    try {
      const channelId = randomUUID()
      const token = randomBytes(32).toString('base64url')
      const result = await watchSheet(registration.spreadsheet_id, channelId, token)
      await db.from('sheet_watch_channels').insert({
        registration_id: registrationId,
        channel_id: result.channel_id,
        resource_id: result.resource_id,
        expiration: result.expiration.toISOString(),
        token,
      })
      watchActive = true
    } catch (err) {
      console.error('[sheet-sync] Watch setup failed (non-fatal):', err)
    }
  } else {
    watchActive = true
  }

  return NextResponse.json({ updated, created, watchActive, paymentLinksSent, skippedForDateOfBirth })
}
