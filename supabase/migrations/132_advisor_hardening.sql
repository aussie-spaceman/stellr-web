-- Supabase advisor hardening (from the 8 Jul 2026 code review).
--
-- Scope note: the three SECURITY DEFINER function WARNs the advisor also reports
-- (can_read_space, can_read_chat_channel, space_unread_counts) are DELIBERATELY
-- left as-is. They are RLS helper functions — can_read_chat_channel gates a
-- realtime SELECT policy (047_chat_realtime), can_read_space gates the spaces
-- realtime policy (071_spaces_realtime), and space_unread_counts is called via
-- RPC — so they MUST be SECURITY DEFINER (to avoid RLS recursion) and MUST stay
-- EXECUTE-able by authenticated (or the policies that call them fail). Revoking
-- EXECUTE would break chat/space access. Only the ERROR-level and duplicate-index
-- items below are safe to change.

-- 1) ERROR: SECURITY DEFINER view. Run access_redundancy_audit with the querying
--    role's privileges so it enforces the caller's RLS, not the view creator's.
--    The Conflicts panel reads it via the service role (admin-gated route), which
--    bypasses RLS either way, so this only tightens the exposed-API case.
ALTER VIEW public.access_redundancy_audit SET (security_invoker = on);

-- 2) WARN duplicate_index: two identical UNIQUE constraints on
--    entitlements.tiers(membership_tier_id). Drop the redundant one (keep the
--    conventional _key); dropping the constraint drops its backing index.
ALTER TABLE entitlements.tiers DROP CONSTRAINT IF EXISTS tiers_membership_tier_id_uniq;

-- 3) WARN duplicate_index: two identical plain indexes on
--    public.event_participations(member_id). Keep idx_event_part_member.
DROP INDEX IF EXISTS public.event_participations_member_id_idx;
