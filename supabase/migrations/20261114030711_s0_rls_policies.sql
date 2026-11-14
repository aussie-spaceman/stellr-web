-- S0-3 (Security Advisor "rls_enabled_no_policy"): every table with row level
-- security on now has either a policy or an explicit, recorded deny.
--
-- docs/SECURITY-HOTFIX-C-2026-11-02.md left these for S0-3. It counted 21 on
-- production on 3 Nov; the schema CI builds has 22. Since that read,
-- member_pending_consent and recording_offloads landed (+2), and
-- 20261104200000_tenant_isolation_policies gave public.team_profiles its
-- tenant_app policies (-1).
--
-- The list, derived from the schema CI builds (supabase/baseline.sql plus
-- every timestamped migration): pg_class in public or entitlements, relkind
-- 'r' or 'p', relrowsecurity, and no pg_policy row. Each table was checked
-- for a reader that is not service_role:
--   * the browser Supabase clients (lib/supabase-browser.ts) are used only for
--     chat Realtime and signed storage uploads, and touch none of these;
--   * tenant_app (lib/tenancy/db.ts, the S4 tenant role, NOBYPASSRLS) is
--     granted none of them;
--   * every other read and write is server-side through service_role, which
--     has BYPASSRLS and so never needed a policy.
-- So none gets a policy: adding one would open access nothing uses today.
-- Each gets the explicit-deny comment instead, which records that "RLS on, no
-- policy" is deliberate. Where the table already had a description, the
-- description is kept after the marker.
--
--   entitlements.account_credit_ledger      baseline.sql
--   entitlements.bookings                   baseline.sql
--   entitlements.coupon_redemptions         baseline.sql
--   entitlements.discounts                  baseline.sql
--   entitlements.entitlements               baseline.sql
--   entitlements.member_grant_runs          baseline.sql
--   entitlements.offerings                  baseline.sql
--   entitlements.prices                     baseline.sql
--   entitlements.processed_events           baseline.sql
--   entitlements.tier_benefits              baseline.sql
--   entitlements.tiers                      baseline.sql
--   public.audit_log                        baseline.sql
--   public.crawler_hits                     20260925024500_crawler_hits.sql
--   public.lead_capture_failures            baseline.sql
--   public.member_memberships               baseline.sql
--   public.member_pending_consent           20261103234607_member_pending_consent.sql
--   public.member_schools                   baseline.sql
--   public.membership_tiers                 baseline.sql
--   public.recording_offloads               20261104500000_recording_offloads.sql
--   public.schools                          baseline.sql
--   public.stripe_webhook_events            baseline.sql
--   public.video_watermark_jobs             baseline.sql
--
-- What this changes: table comments only. No grant, policy or RLS setting
-- changes, so no role gains or loses access. anon and authenticated stay
-- refused by RLS (no policy matches them); service_role keeps reading through
-- BYPASSRLS. A new RLS table must now ship a policy or this comment, or
-- supabase/tests/security_checks.sql and the pgTAP test
-- supabase/tests/database/s0_search_path_rls.test.sql flag it.
--
-- Idempotent: re-running sets the same comments.
--
-- NOT APPLIED to any database by the PR that adds it. Proven only by CI's
-- `db` job.

COMMENT ON TABLE entitlements.account_credit_ledger IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.bookings IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.coupon_redemptions IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.discounts IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.entitlements IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.member_grant_runs IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.offerings IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.prices IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.processed_events IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.tier_benefits IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE entitlements.tiers IS 'RLS on, no policy: service_role only (S0-3)';

COMMENT ON TABLE public.audit_log IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.crawler_hits IS
  'RLS on, no policy: service_role only (S0-3). Page requests from named search/AI crawlers on www (lib/crawlers.ts). Read by scripts/aeo-crawler-report.ts.';
COMMENT ON TABLE public.lead_capture_failures IS
  'RLS on, no policy: service_role only (S0-3). Dead-letter queue for lead captures that failed to reach HubSpot. Recovery net only — HubSpot remains the source of truth.';
COMMENT ON TABLE public.member_memberships IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.member_pending_consent IS
  'RLS on, no policy: service_role only (S0-3). Self-registered minors awaiting a parent or guardian''s consent (decision 24). Unconsented rows past purge_after are purged with their member.';
COMMENT ON TABLE public.member_schools IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.membership_tiers IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.recording_offloads IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.schools IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.stripe_webhook_events IS 'RLS on, no policy: service_role only (S0-3)';
COMMENT ON TABLE public.video_watermark_jobs IS 'RLS on, no policy: service_role only (S0-3)';
