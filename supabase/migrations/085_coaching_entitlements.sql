-- Migration 085: coaching free-session entitlements (Coaching = 1-on-1 Workshops).
--
-- Coaching reuses the container model from 064 (mentoring_cohorts with
-- container_type='coaching', one coachee on the roster) and the session machinery
-- in lib/sessions.ts (session_type='coaching'). What's missing is the per-tier
-- FREE-SESSION ALLOWANCE that drives the member's "X free sessions left" counter
-- and the admin Membership & access "Coaching" column.
--
-- Decision (2026-06-24): the free-coaching tier set MIRRORS the free-mentoring
-- tiers (membership_tiers.includes_free_mentoring, seeded in 070). Each such tier
-- gets a default coaching allowance of 6 sessions per membership year
-- (validity_days = 365 ⇒ annual reset, no rollover). These numbers are editable
-- per tier in the admin Membership & access screen (session_entitlements).
--
-- The allowance is consumed by booked coaching sessions (lib/coaching.ts
-- getCoachingAllowance counts scheduled/completed coaching sessions in the current
-- membership year); a cancelled session is no longer counted, which is the
-- refund-on-cancel behaviour. Paid top-ups live in session_credits
-- (session_type='coaching', already allowed by 018/078).
--
-- ADDITIVE + idempotent. session_entitlements.session_type already allows
-- 'coaching' (018). No schema changes — data seed only.

INSERT INTO public.session_entitlements (tier_id, session_type, included_sessions, validity_days)
SELECT t.id, 'coaching', 6, 365
FROM public.membership_tiers t
WHERE t.includes_free_mentoring = true
ON CONFLICT (tier_id, session_type) DO NOTHING;
