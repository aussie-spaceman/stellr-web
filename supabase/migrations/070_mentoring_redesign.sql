-- 070_mentoring_redesign.sql
-- Mentoring V2 redesign (Claude Design handoff). Mentoring = small-group Cohorts.
-- Adds the columns the redesign needs on top of the existing M1–M6 schema
-- (018 sessions/cohorts, 050 training links, 052 invites, 062 container convergence):
--   * mentoring_cohorts   — discoverability + self-register pricing + per-cohort
--                           theme / timezone / planned session count / start date.
--   * membership_tiers    — `includes_free_mentoring` (the Membership & access
--                           toggle, drives free cohort access) + a per-tier annual
--                           mentoring credit grant.
--   * session_credits     — repurposed as the mentoring credit ledger: a `source`
--                           (allowance | purchase | topup), the cohort a credit was
--                           spent on, and an idempotency key for the annual grant.
--
-- DECISIONS (confirmed 2026-06-23): free-mentoring is per-tier & admin-editable;
-- credits = per-tier annual grant (1 credit = 1 cohort enrollment); unused credits
-- ROLL OVER (allowance rows are never expired); paid top-ups allowed; a cohort
-- cancellation refunds the spent credit as account credit (handled in app code).
--
-- Conventions follow prior migrations: ADD COLUMN IF NOT EXISTS, service-role RLS
-- already present on these tables. PRICE for the one-off stays read from Stripe at
-- runtime where a price id is set; one_off_price_cents is the admin-set USD amount.

-- ─── 1. mentoring_cohorts: discoverability, pricing, presentation ───────────
ALTER TABLE public.mentoring_cohorts
  ADD COLUMN IF NOT EXISTS theme              text NOT NULL DEFAULT 'space',          -- 'space' | 'enviro' (theme tile colour)
  ADD COLUMN IF NOT EXISTS timezone           text NOT NULL DEFAULT 'America/Chicago',-- IANA tz; default US Central (CT)
  ADD COLUMN IF NOT EXISTS planned_sessions   integer NOT NULL DEFAULT 6,             -- "Number of sessions" at create
  ADD COLUMN IF NOT EXISTS start_date         date,                                   -- cohort start (shown on cards)
  ADD COLUMN IF NOT EXISTS is_open            boolean NOT NULL DEFAULT false,         -- discoverable + self-registerable
  ADD COLUMN IF NOT EXISTS blurb              text,                                   -- short description for discover cards
  ADD COLUMN IF NOT EXISTS free_for_tier_ids  uuid[] NOT NULL DEFAULT '{}',           -- tiers that get THIS cohort free
  ADD COLUMN IF NOT EXISTS one_off_price_cents integer,                              -- USD one-off price (null = no paid option)
  ADD COLUMN IF NOT EXISTS one_off_stripe_price_id text,                             -- optional pre-made Stripe price
  ADD COLUMN IF NOT EXISTS credit_cost        integer NOT NULL DEFAULT 1;            -- mentoring credits to enroll (usually 1)

CREATE INDEX IF NOT EXISTS mentoring_cohorts_open_idx
  ON public.mentoring_cohorts(is_open) WHERE container_type = 'mentoring';

-- ─── 2. membership_tiers: free-mentoring toggle + annual credit grant ───────
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS includes_free_mentoring boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mentoring_credits_grant integer NOT NULL DEFAULT 0;

-- Seed sensible defaults (admin can flip any on the Membership & access screen):
-- the six paid buyable tiers include free mentoring; the three free buyable tiers
-- and all system/background tiers do not. Credits grant stays 0 until set per tier.
UPDATE public.membership_tiers
  SET includes_free_mentoring = true
  WHERE name IN ('Pathfinder', 'Scholar', 'Contributor', 'Counselor', 'Innovator', 'Trailblazer');

-- ─── 3. session_credits: mentoring credit ledger ───────────────────────────
-- Existing columns: member_id, session_type, status(available|consumed),
-- consumed_session_id, stripe_session_id, created_at, consumed_at.
-- Mentoring credits reuse this table with session_type='mentoring'.
ALTER TABLE public.session_credits
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'purchase'
                            CHECK (source IN ('allowance', 'purchase', 'topup')),
  ADD COLUMN IF NOT EXISTS consumed_cohort_id uuid REFERENCES public.mentoring_cohorts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grant_key          text;  -- idempotency key for annual allowance grants (= member_membership id)

CREATE INDEX IF NOT EXISTS session_credits_member_type_status_idx
  ON public.session_credits(member_id, session_type, status);
CREATE INDEX IF NOT EXISTS session_credits_grant_key_idx
  ON public.session_credits(grant_key) WHERE grant_key IS NOT NULL;

-- ─── 4. session_actions: cohort-level task system ──────────────────────────
-- The redesign's Actions tab assigns tasks at the COHORT level (to all mentees
-- or one), not only as session close-outs. Add cohort_id + a batch id (one
-- "assign action" → one row per assignee, grouped for the mentor's "5/8" view)
-- + an optional 24h reminder flag, and relax session_id to allow cohort tasks.
ALTER TABLE public.session_actions
  ADD COLUMN IF NOT EXISTS cohort_id          uuid REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS batch_id           uuid,
  ADD COLUMN IF NOT EXISTS remind_before_hours integer;

ALTER TABLE public.session_actions ALTER COLUMN session_id DROP NOT NULL;

-- Backfill cohort_id for existing session-tied actions so cohort queries see them.
UPDATE public.session_actions sa
  SET cohort_id = s.cohort_id
  FROM public.sessions s
  WHERE sa.session_id = s.id AND sa.cohort_id IS NULL AND s.cohort_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS session_actions_cohort_idx ON public.session_actions(cohort_id);
CREATE INDEX IF NOT EXISTS session_actions_batch_idx  ON public.session_actions(batch_id) WHERE batch_id IS NOT NULL;
