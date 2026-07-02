-- 118_security_advisor_warn_hardening.sql
-- Clears the two WARN-level Supabase security-advisor findings on the prod
-- project (Stellr Registrations, hwtzpfrnksksxlwwabqz), verified 2026-07-01.
-- These are hardening only — no ERROR/critical findings exist (no RLS-disabled
-- tables, no anon-reachable open policies).
--
-- ────────────────────────────────────────────────────────────────────────────
-- PART 1 — function_search_path_mutable (advisor 0011), 12 functions.
--
-- These entitlements helpers were created without a pinned search_path. A role
-- with a mutable search_path lets a caller shadow unqualified object names via
-- their own session search_path. Their SECURITY DEFINER siblings already pin
-- `search_path = entitlements, public` (see migrations 105+); this applies the
-- same value to the remaining (SECURITY INVOKER) functions. Bodies are
-- unchanged and already reference entitlements/public objects, so resolution is
-- identical — zero behavioural change.
-- ────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION entitlements.fn_active_tier(uuid)                                                   SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_allocation_balance(uuid, entitlements.entitlement_kind, uuid, entitlements.offering_type) SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_base_price_cents(uuid)                                              SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_credit_balance(uuid)                                                SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_kind_to_offering(entitlements.entitlement_kind)                     SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_period_start(text, timestamptz, timestamptz)                        SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_purchase_expiry()                                                   SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_quote(uuid, uuid, text)                                             SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_tier_discount_pct(uuid, entitlements.offering_type)                 SET search_path = entitlements, public;
ALTER FUNCTION entitlements.fn_validate_coupon(text, entitlements.offering_type)                   SET search_path = entitlements, public;
ALTER FUNCTION entitlements.trg_booking_guard()                                                    SET search_path = entitlements, public;
ALTER FUNCTION entitlements.trg_touch_updated_at()                                                 SET search_path = entitlements, public;

-- ────────────────────────────────────────────────────────────────────────────
-- PART 2 — SECURITY DEFINER functions executable by anon (advisor 0028).
--
-- can_read_chat_channel / can_read_space are RLS helper functions used inside
-- authenticated SELECT policies on chat_messages, community_posts and
-- community_comments. They were also granted to anon + PUBLIC, which nothing
-- uses — a not-signed-in caller could hit /rest/v1/rpc/... directly and probe
-- channel/space membership. Revoke the anonymous grants; KEEP authenticated and
-- service_role, which the RLS policies (and the app) require.
--
-- space_unread_counts already has no anon/PUBLIC grant; the REVOKE below is a
-- harmless no-op kept for defence-in-depth.
--
-- NOTE ON RESIDUAL LINTS (intentionally NOT changed here):
-- After this migration the advisor will still list these three functions under
-- 0029 (authenticated can execute). That is expected and safe:
--   • can_read_chat_channel / can_read_space MUST be executable by the
--     `authenticated` role or their RLS policies fail closed and break
--     chat/community reads.
--   • space_unread_counts is a legitimate app RPC the member app calls.
-- Fully silencing 0029 would mean relocating the two helpers to a non-API
-- schema (and re-pointing their policies) and reworking space_unread_counts to
-- derive the member from the JWT instead of a parameter — tracked separately.
-- ────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.can_read_chat_channel(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_read_space(uuid, text)        FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.space_unread_counts(uuid)         FROM anon, PUBLIC;
