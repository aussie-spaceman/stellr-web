import type { SupabaseClient } from '@supabase/supabase-js'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { shareConsentOrUnreadable, unpublishCredentialsFor } from '@/lib/credentials'

// ── Daily sweep: public pages of holders who are Minors under the policy ─────
//
// legal-credential-family-link.4. Making a page public is gated once, at the
// toggle (setVisibility). Since 9 Oct 2026 "Minor" is the policy's (Privacy
// Policy §2, §7.4: under the age of majority in their state, or still in
// school), so a page an 18-year-old in Alabama or Nebraska, a 20-year-old in
// Mississippi, or a student still in school made public before then can still
// be public with no guardian's consent. The public page already hides the name
// on every view (publicShareAllowed), so this sweep brings the stored
// visibility into line with what the page shows: it never hides a page that
// is showing a name today, unless the rule itself has changed.
//
// What counts is the publish gate's own rule (shareConsentOrUnreadable, the
// strict form of shareConsentFor): a holder who is a Minor, with no guardian
// consent that permits a public page, goes private through
// unpublishCredentialsFor. An adult, or a Minor whose guardian consented, is
// left alone. A holder whose records cannot be read is skipped and counted as
// an error, never unpublished on a guess.
//
// Stellr's credentials only (a NULL tenant is a Stellr row the backfill has not
// reached): the policy is Stellr's, and only Stellr's pages are served.
// Returns counts and logs counts: no names, ids or contact details. Idempotent,
// since a page it made private is no longer a candidate. Bounded per run by
// holders checked and by time; a run that stops early says so (truncated), and
// the next run starts again from the beginning.
//
// Takes the client from its caller (the daily entitlements cron), and is not a
// route or a cron of its own.

export interface CredentialMinorSweepResult {
  /** Public credential rows read. */
  scanned: number
  /** Distinct holders whose consent was checked. */
  checked: number
  /** Holders whose pages were made private. */
  holdersUnpublished: number
  /** Pages made private. */
  unpublished: number
  /** Holders skipped because a read or the write failed. */
  errors: number
  /** True when the run stopped at its limit before reaching the end. */
  truncated: boolean
}

export interface CredentialMinorSweepOptions {
  /** Rows read per page. */
  pageSize?: number
  /** Distinct holders checked per run. */
  maxHolders?: number
  /** Stop starting new checks after this long (ms). */
  budgetMs?: number
  /** Holders checked at once. */
  concurrency?: number
  /** For tests. */
  now?: () => number
}

interface Candidate {
  id: string
  member_id: string | null
  participant_id: string | null
  is_minor: boolean
}

const STELLR_SCOPE = `tenant_id.eq.${STELLR_TENANT_ID},tenant_id.is.null`

export async function sweepMinorCredentialPages(
  db: SupabaseClient,
  opts: CredentialMinorSweepOptions = {},
): Promise<CredentialMinorSweepResult> {
  const pageSize = opts.pageSize ?? 200
  const maxHolders = opts.maxHolders ?? 1000
  const concurrency = Math.max(1, opts.concurrency ?? 5)
  const clock = opts.now ?? Date.now
  const deadline = clock() + (opts.budgetMs ?? 90_000)

  const out: CredentialMinorSweepResult = {
    scanned: 0, checked: 0, holdersUnpublished: 0, unpublished: 0, errors: 0, truncated: false,
  }
  const seen = new Set<string>()
  let after: string | null = null

  for (;;) {
    let q = db
      .from('credentials')
      .select('id, member_id, participant_id, is_minor')
      .eq('visibility', 'public')
      .is('tombstoned_at', null)
      .or(STELLR_SCOPE)
    if (after) q = q.gt('id', after)
    const { data, error } = await q.order('id', { ascending: true }).limit(pageSize)
    // Listing failed: nothing to judge. The caller records it on the run.
    if (error) throw new Error(`[credential-minor-sweep] listing public credentials failed: ${error.message}`)
    const rows = (data ?? []) as Candidate[]
    out.scanned += rows.length

    // One check per holder; is_minor is part of the key because the rule reads it.
    const fresh: Candidate[] = []
    for (const r of rows) {
      if (!r.member_id && !r.participant_id) continue
      const key = `${r.member_id ?? ''}|${r.participant_id ?? ''}|${r.is_minor ? 1 : 0}`
      if (seen.has(key)) continue
      seen.add(key)
      fresh.push(r)
    }

    let i = 0
    while (i < fresh.length) {
      if (out.checked >= maxHolders || clock() >= deadline) {
        out.truncated = true
        return finish(out)
      }
      const n = Math.min(concurrency, maxHolders - out.checked, fresh.length - i)
      const batch = fresh.slice(i, i + n)
      i += n
      out.checked += batch.length
      const results = await Promise.all(batch.map((c) => sweepHolder(db, c)))
      for (const r of results) {
        if (r === 'error') out.errors++
        else if (r > 0) { out.holdersUnpublished++; out.unpublished += r }
      }
    }

    if (rows.length < pageSize) return finish(out)
    after = rows[rows.length - 1].id
  }
}

/** Pages made private for this holder (0 when they may stay public), or 'error'. */
async function sweepHolder(db: SupabaseClient, c: Candidate): Promise<number | 'error'> {
  try {
    const consent = await shareConsentOrUnreadable(db, c)
    if (consent === 'unreadable') return 'error'
    // An adult, or a Minor whose guardian's consent permits a public page.
    if (consent === 'not_required' || consent === 'granted') return 0
    const changed = await unpublishCredentialsFor(
      db,
      { memberId: c.member_id, participantId: c.participant_id, tenant: { value: STELLR_TENANT_ID, includeNull: true } },
      { throwOnError: true },
    )
    return changed.length
  } catch {
    return 'error'
  }
}

function finish(out: CredentialMinorSweepResult): CredentialMinorSweepResult {
  if (out.unpublished > 0 || out.errors > 0 || out.truncated) {
    console.log(
      `[credential-minor-sweep] scanned ${out.scanned}, checked ${out.checked}, ` +
        `made ${out.unpublished} page(s) private for ${out.holdersUnpublished} holder(s), ` +
        `${out.errors} error(s)${out.truncated ? ', stopped at the per-run limit' : ''}`,
    )
  }
  return out
}
