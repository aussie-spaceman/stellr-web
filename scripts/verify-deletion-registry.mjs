// Read-only validation: runs each registry dependent's count query against the
// live DB with a non-matching id (zero rows, zero mutations) to confirm the
// table/column names actually exist. Run: node scripts/verify-deletion-registry.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// Minimal .env.local loader (script runs outside Next).
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const NOMATCH_UUID = '00000000-0000-0000-0000-000000000000'

// Mirror of the registry dependents + spans (table, column) pairs to validate.
const CHECKS = [
  ['members', 'id'], ['members', 'clerk_user_id'], ['members', 'is_active'], ['members', 'deleted_at'],
  ['registrations', 'teacher_member_id'], ['registrations', 'event_slug'], ['registrations', 'status'], ['registrations', 'withdrawn_at'],
  ['sessions', 'host_member_id'], ['sessions', 'cohort_id'], ['sessions', 'member_id'], ['sessions', 'status'],
  ['member_schools', 'school_id'], ['member_schools', 'member_id'],
  ['schools', 'is_active'],
  ['event_participations', 'event_slug'], ['event_participations', 'member_id'],
  ['event_settings', 'event_slug'], ['event_companies', 'event_slug'], ['event_manager_assignments', 'event_slug'],
  ['email_campaigns', 'template_id'], ['email_campaign_sends', 'campaign_id'],
  ['community_posts', 'space_id'], ['community_posts', 'status'],
  ['community_spaces', 'is_archived'],
  ['training_enrollments', 'module_id'],
  ['mentoring_cohorts', 'is_active'],
  ['membership_tiers', 'is_active'],
  ['session_participants', 'member_id'], ['session_participants', 'session_id'],
  ['docusign_envelopes', 'member_id'], ['docusign_envelopes', 'participant_id'],
  ['participants', 'registration_id'],
  // refund engine (migration 027)
  ['participants', 'stripe_payment_intent_id'], ['registrations', 'stripe_payment_intent_id'],
  ['refund_policies', 'scope'], ['account_credits', 'member_id'],
  ['account_credits', 'remaining_cents'], ['credit_redemptions', 'credit_id'],
  ['event_refunds', 'participant_id'],
  // web store (migration 051)
  ['store_products', 'status'], ['store_variants', 'product_id'],
  ['store_tier_discounts', 'product_id'], ['store_event_discounts', 'product_id'],
  ['store_orders', 'status'], ['member_addresses', 'id'],
]

let ok = 0, bad = 0
for (const [table, column] of CHECKS) {
  const { error } = await db.from(table).select('*', { count: 'exact', head: true }).eq(column, NOMATCH_UUID)
  if (error) {
    // 22P02 = invalid uuid input for a non-uuid column; that still proves the
    // column exists, so treat only "does not exist" as a real failure.
    if (/does not exist/i.test(error.message)) {
      console.log(`  ✗ ${table}.${column} — ${error.message}`)
      bad++
    } else {
      console.log(`  ~ ${table}.${column} — exists (non-fatal: ${error.code})`)
      ok++
    }
  } else {
    console.log(`  ✓ ${table}.${column}`)
    ok++
  }
}
console.log(`\n${ok} ok, ${bad} missing`)
process.exit(bad > 0 ? 1 : 0)
