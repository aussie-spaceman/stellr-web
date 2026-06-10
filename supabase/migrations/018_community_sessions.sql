-- Migration 018: Coaching (FR-COM-12) + Mentoring (FR-COM-11) — sessions engine.
--
-- One engine serves both: coaching is 1:1 (sessions.member_id set), mentoring is
-- small-group (sessions.cohort_id set). Video is provider-agnostic (JaaS default,
-- Zoom fallback) — see lib/video-provider.ts. Recordings are offloaded to private
-- Supabase Storage (recording_path). SMS reminders are deferred to a later build;
-- delivery preferences already live in member_notification_prefs (migration 017).
--
-- Conventions follow migrations 012/017: gen_random_uuid() PKs, authorship via
-- members(id), RLS enabled with a single service-role policy (all gating in the
-- server layer).

-- ─── session_hosts ─────────────────────────────────────────────────────────
-- Who may coach and/or mentor. Admins grant these; per the PRD a coach/mentor
-- permission may be assigned to anyone EXCEPT an Event Participation Role of
-- School Student (enforced in the admin API, not here).
CREATE TABLE IF NOT EXISTS public.session_hosts (
  member_id    uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  can_coach    boolean NOT NULL DEFAULT false,
  can_mentor   boolean NOT NULL DEFAULT false,
  bio          text,
  approved_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  approved_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.session_hosts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_hosts"
    ON public.session_hosts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── session_entitlements ──────────────────────────────────────────────────
-- Tier → included session counts + validity (config; admin-editable). This is
-- the "how many sessions does a tier get" half of the entitlement model that is
-- still being mapped out, kept as data so it can change without code edits.
-- extra_stripe_price_id powers buying additional sessions when included run out.
CREATE TABLE IF NOT EXISTS public.session_entitlements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id             uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  session_type        text NOT NULL CHECK (session_type IN ('coaching', 'mentoring')),
  included_sessions   integer NOT NULL DEFAULT 0,
  validity_days       integer,                 -- null = no expiry
  extra_stripe_price_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier_id, session_type)
);

ALTER TABLE public.session_entitlements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_entitlements"
    ON public.session_entitlements FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── mentoring_cohorts + cohort_members ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mentoring_cohorts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  mentor_member_id  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mentoring_cohorts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access mentoring_cohorts"
    ON public.mentoring_cohorts FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cohort_members (
  cohort_id  uuid NOT NULL REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cohort_id, member_id)
);

ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access cohort_members"
    ON public.cohort_members FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── host_availability ─────────────────────────────────────────────────────
-- Weekly recurring availability windows. Times are minutes-from-midnight in the
-- host's local zone; the booking UI resolves them to concrete slots.
CREATE TABLE IF NOT EXISTS public.host_availability (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_member_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_minute    integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute      integer NOT NULL CHECK (end_minute BETWEEN 0 AND 1440),
  session_type    text NOT NULL DEFAULT 'both'
                    CHECK (session_type IN ('coaching', 'mentoring', 'both')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_availability_host_idx
  ON public.host_availability(host_member_id, weekday);

ALTER TABLE public.host_availability ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access host_availability"
    ON public.host_availability FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── sessions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_type     text NOT NULL CHECK (session_type IN ('coaching', 'mentoring')),
  host_member_id   uuid REFERENCES public.members(id) ON DELETE SET NULL,
  cohort_id        uuid REFERENCES public.mentoring_cohorts(id) ON DELETE SET NULL, -- mentoring
  member_id        uuid REFERENCES public.members(id) ON DELETE SET NULL,           -- coaching coachee
  title            text,
  scheduled_start  timestamptz NOT NULL,
  scheduled_end    timestamptz,
  status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('requested', 'scheduled', 'declined', 'cancelled', 'completed')),
  provider         text,          -- 'jaas' | 'zoom'
  provider_room    text,          -- room name / meeting id
  join_url         text,          -- convenience URL (token minted per-join)
  recording_path   text,          -- private Supabase Storage path after offload
  recording_status text NOT NULL DEFAULT 'none'
                     CHECK (recording_status IN ('none', 'pending', 'available')),
  host_notes       text,
  is_paid_extra    boolean NOT NULL DEFAULT false,
  created_by       uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_host_idx     ON public.sessions(host_member_id, scheduled_start);
CREATE INDEX IF NOT EXISTS sessions_member_idx   ON public.sessions(member_id, scheduled_start);
CREATE INDEX IF NOT EXISTS sessions_cohort_idx   ON public.sessions(cohort_id, scheduled_start);
CREATE INDEX IF NOT EXISTS sessions_start_idx    ON public.sessions(scheduled_start);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access sessions"
    ON public.sessions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── session_participants ──────────────────────────────────────────────────
-- Denormalized attendee list (cohort members fanned out at scheduling time) for
-- invites, recording visibility, and "my sessions" lookups.
CREATE TABLE IF NOT EXISTS public.session_participants (
  session_id  uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, member_id)
);

CREATE INDEX IF NOT EXISTS session_participants_member_idx
  ON public.session_participants(member_id);

ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_participants"
    ON public.session_participants FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── session_actions + templates ───────────────────────────────────────────
-- Host-set close-out actions a member checks off (progress). Templates are the
-- preconfigured, editable defaults: host_member_id NULL = global admin default.
CREATE TABLE IF NOT EXISTS public.session_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  member_id     uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  title         text NOT NULL,
  is_done       boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  created_by    uuid REFERENCES public.members(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_actions_session_idx ON public.session_actions(session_id);
CREATE INDEX IF NOT EXISTS session_actions_member_idx  ON public.session_actions(member_id, is_done);

ALTER TABLE public.session_actions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_actions"
    ON public.session_actions FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.session_action_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_member_id  uuid REFERENCES public.members(id) ON DELETE CASCADE,  -- NULL = global default
  session_type    text NOT NULL CHECK (session_type IN ('coaching', 'mentoring')),
  title           text NOT NULL,
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_action_templates_host_idx
  ON public.session_action_templates(host_member_id, session_type);

ALTER TABLE public.session_action_templates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access session_action_templates"
    ON public.session_action_templates FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── chat_channels + chat_messages ─────────────────────────────────────────
-- Persistent chat that outlives any single session (FR-COM-11/12). A 'cohort'
-- channel is the mentoring group chat; a 'coaching' channel is the private 1:1
-- between a coachee (member_id) and coach (host_member_id).
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('cohort', 'coaching')),
  cohort_id       uuid REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE,
  member_id       uuid REFERENCES public.members(id) ON DELETE CASCADE,
  host_member_id  uuid REFERENCES public.members(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One cohort channel per cohort; one coaching channel per (coachee, coach) pair.
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_cohort_uniq
  ON public.chat_channels(cohort_id) WHERE kind = 'cohort';
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_coaching_uniq
  ON public.chat_channels(member_id, host_member_id) WHERE kind = 'coaching';

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access chat_channels"
    ON public.chat_channels FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id        uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  author_member_id  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  body              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx
  ON public.chat_messages(channel_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service role full access chat_messages"
    ON public.chat_messages FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Extend community_notifications types for session events ────────────────
-- migration 012 constrained type to reply/mention/announcement/resource; add the
-- session lifecycle types (booked, reminders, recording ready) used by lib/notify.
DO $$ BEGIN
  ALTER TABLE public.community_notifications DROP CONSTRAINT IF EXISTS community_notifications_type_check;
  ALTER TABLE public.community_notifications
    ADD CONSTRAINT community_notifications_type_check
    CHECK (type IN ('reply', 'mention', 'announcement', 'resource',
                    'session', 'session_reminder', 'recording', 'action'));
EXCEPTION WHEN others THEN NULL; END $$;

-- ─── Seed global close-out action templates ────────────────────────────────
INSERT INTO public.session_action_templates (host_member_id, session_type, title, display_order)
VALUES
  (NULL, 'coaching',  'Review session recording',            0),
  (NULL, 'coaching',  'Complete agreed next step',           1),
  (NULL, 'mentoring', 'Share takeaway with your cohort',     0),
  (NULL, 'mentoring', 'Prepare a question for next session', 1)
ON CONFLICT DO NOTHING;
