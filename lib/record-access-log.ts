import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { auth } from '@clerk/nextjs/server'
import { portalRoleFromClaims } from '@/lib/authz/decide'
import { supabaseServer } from '@/lib/supabase'

// Who looked at what in the admin portal (Staff role phase 4, 14 Nov 2026).
//
// One append-only row per view of a minor's record, per roster view and per
// export, in record_access_log. IDs only: the person's members.id, the event slug,
// the route and a count. Never a name, a date of birth or contact details, so the
// log is not itself a second copy of the data it watches.
//
// Best-effort: a failed write is reported and never stops the page or export. The
// Friday digest reads the log for the week's exports and any account viewing far
// more minors' records than usual (lib/admin-digest.ts).

export type RecordAccessAction = 'minor_record_view' | 'roster_view' | 'export'

export interface RecordAccessInput {
  action: RecordAccessAction
  route: string
  subjectMemberId?: string | null
  eventSlug?: string | null
  rowCount?: number | null
  /** Small ID-only facts (the export kind, the filter keys used). Never PII. */
  detail?: Record<string, string | number | boolean | null>
}

/** Keys a detail may never carry: it is an ID-only log. */
const FORBIDDEN_DETAIL = /name|email|phone|dob|birth|address|contact|medical|health|allerg|note/i

/** The detail as stored: forbidden keys dropped, strings capped. Pure. */
export function cleanDetail(detail: RecordAccessInput['detail']): Record<string, string | number | boolean | null> | null {
  if (!detail) return null
  const out: Record<string, string | number | boolean | null> = {}
  for (const [k, v] of Object.entries(detail)) {
    if (FORBIDDEN_DETAIL.test(k)) continue
    out[k] = typeof v === 'string' ? v.slice(0, 120) : v
  }
  return Object.keys(out).length ? out : null
}

/** Record one view or export by the signed-in portal user. Never throws. */
export async function logRecordAccess(input: RecordAccessInput, db?: SupabaseClient): Promise<void> {
  try {
    const { userId, sessionClaims } = await auth()
    if (!userId) return
    const role = portalRoleFromClaims(sessionClaims) ?? 'unknown'
    const { error } = await (db ?? supabaseServer()).from('record_access_log').insert({
      actor: userId,
      actor_role: role,
      action: input.action,
      subject_member_id: input.subjectMemberId ?? null,
      subject_event: input.eventSlug ?? null,
      route: input.route,
      row_count: input.rowCount ?? null,
      detail: cleanDetail(input.detail),
    })
    if (error) console.error('[record-access-log] write failed:', error.message)
  } catch (err) {
    console.error('[record-access-log] write failed:', err instanceof Error ? err.message : err)
  }
}
