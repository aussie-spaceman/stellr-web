-- PHASE 5 — drop the retired `session_credits` wallet table.
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ POST-DEPLOY ONLY. Run this by hand (Supabase SQL editor or psql) AFTER the
-- entitlements-cutover code batch is DEPLOYED to prod — NOT via `supabase db push`
-- alongside the code, and NOT before. It lives in docs/ (not supabase/migrations/)
-- on purpose, so a routine migration push can't drop the table while prod is still
-- running the pre-batch code.
--
-- WHY ordering matters: the currently-deployed code still reads/writes
-- session_credits (lib/sessions.getEntitlement, lib/{mentoring,coaching}.enrollAfterPayment,
-- the topup webhook branches). The cutover batch (migrations 106–111 + lib changes)
-- removes every one of those readers and routes everything through the entitlements
-- ledger. Only once that code is live is session_credits truly unreferenced.
--
-- PRECONDITIONS (verified 2026-06-29): 0 rows; the only DB objects referencing the
-- table are the two dead functions dropped below + one service-role RLS policy
-- (cleared by CASCADE). Re-verify `select count(*) from session_credits;` = 0 and a
-- fresh grep of the deployed code for `session_credits` before running.
--
-- NOT dropped here: `session_entitlements`. It still backs the admin coaching-tier
-- editor (lib/coaching.updateTierCoaching, app/api/admin/community/{coaching,
-- session-entitlements}) and the extra-session purchase eligibility read
-- (app/api/community/sessions/purchase). Migrate that admin config to
-- entitlements.tier_benefits (setTierAllocationQuantity) first, then drop it
-- separately.
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists public.consume_session_credit(p_member_id uuid, p_session_type text, p_session_id uuid);
drop function if exists entitlements.fn_backfill_legacy_credits();
drop table if exists public.session_credits cascade;  -- cascade clears the service-role RLS policy
