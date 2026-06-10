-- Migration 017: Community Portal — Phase 4 foundation
-- (Component 3 §5: FR-COM-10 Training, FR-COM-13 Event/Campaign portal, plus the
--  flexible tier-entitlement engine that will also feed FR-COM-11 Mentoring and
--  FR-COM-12 Coaching in later phases.)
--
-- Conventions follow migration 012:
--   * uuid PKs via gen_random_uuid()
--   * authorship references public.members(id)
--   * RLS enabled with a single "service role full access" policy — all gating is
--     enforced in the server layer (Clerk auth + supabaseServer()), NOT via JWT RLS.

-- ─── content_entitlements ──────────────────────────────────────────────────
-- The flexible tier→content gating map (entitlement source of truth).
--
-- The PRD's entitlement model ("which tiers get which gated content / how many
-- mentoring & coaching sessions") is still being mapped out, so gating must be
-- editable at runtime without code or schema changes. Each row grants ONE
-- membership tier some access_level to ONE target. The admin drag-drop UI writes
-- and deletes these rows.
--
-- target_ref interpretation depends on target_type:
--   * uuid-as-text  → an in-DB object (space id, resource id, training module id)
--   * sanity _id    → a Sanity event/campaign document (event_material/campaign_material)
--   * '*'           → the entire category (e.g. all coaching), tier-wide grant
--
-- Resolution strategy (see lib/community.ts memberHasEntitlement): if ANY
-- entitlement row exists for a given (target_type, target_ref), access is decided
-- solely by the table. If NO rows exist for that target, callers fall back to the
-- legacy min_tier_rank column so existing content keeps working unchanged.
CREATE TABLE IF NOT EXISTS public.content_entitlements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_id       uuid NOT NULL REFERENCES public.membership_tiers(id) ON DELETE CASCADE,
  target_type   text NOT NULL CHECK (target_type IN (
                  'space', 'resource', 'training_module',
                  'event_material', 'campaign_material',
                  'mentoring', 'coaching')),
  target_ref    text NOT NULL DEFAULT '*',
  access_level  text NOT NULL DEFAULT 'view'
                  CHECK (access_level IN ('view', 'download', 'enroll', 'host')),
  created_by    uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier_id, target_type, target_ref, access_level)
);

CREATE INDEX IF NOT EXISTS content_entitlements_target_idx
  ON public.content_entitlements(target_type, target_ref);
CREATE INDEX IF NOT EXISTS content_entitlements_tier_idx
  ON public.content_entitlements(tier_id);

ALTER TABLE public.content_entitlements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access content_entitlements"
    ON public.content_entitlements FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Event/Campaign portal columns on community_resources (FR-COM-13) ───────
-- Reuse the existing resource library rather than a parallel table. event_ref
-- ties a resource to a Sanity event/campaign document; material_kind lets the UI
-- (and the Training section) separate Event/Campaign material from CTE/general.
ALTER TABLE public.community_resources
  ADD COLUMN IF NOT EXISTS event_ref     text,
  ADD COLUMN IF NOT EXISTS material_kind text NOT NULL DEFAULT 'general'
    CHECK (material_kind IN ('general', 'event', 'campaign', 'cte'));

CREATE INDEX IF NOT EXISTS community_resources_event_ref_idx
  ON public.community_resources(event_ref) WHERE event_ref IS NOT NULL;

-- ─── training_modules ──────────────────────────────────────────────────────
-- A unit of training (FR-COM-10): e.g. "Pre-event safety briefing", a CTE course.
-- material_kind mirrors community_resources so Event/Campaign vs CTE material is
-- always distinguishable. event_ref optionally ties a module to a Sanity event.
CREATE TABLE IF NOT EXISTS public.training_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text,
  material_kind text NOT NULL DEFAULT 'general'
                  CHECK (material_kind IN ('general', 'event', 'campaign', 'cte')),
  event_ref     text,                         -- Sanity event/campaign _id (nullable)
  min_tier_rank smallint NOT NULL DEFAULT 0,  -- legacy fallback when no entitlement rows
  is_published  boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_modules_event_ref_idx
  ON public.training_modules(event_ref) WHERE event_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_modules_kind_idx
  ON public.training_modules(material_kind);

ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_modules"
    ON public.training_modules FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_items ────────────────────────────────────────────────────────
-- The ordered lessons inside a module. Each item is one piece of content:
--   * 'video'      → uploaded/recorded video in private storage (storage_path)
--   * 'document'   → uploaded file in private storage (storage_path)
--   * 'google_doc' → a shared Google Doc (external_url)
--   * 'link'       → any external URL (external_url)
-- Progress is tracked per item so a member sees "1 of 4" within a module.
CREATE TABLE IF NOT EXISTS public.training_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id         uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  title             text NOT NULL,
  content_kind      text NOT NULL
                      CHECK (content_kind IN ('video', 'document', 'google_doc', 'link')),
  storage_path      text,        -- set for video/document (private bucket)
  external_url      text,        -- set for google_doc/link
  estimated_minutes integer,
  display_order     integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_items_module_idx
  ON public.training_items(module_id, display_order);

ALTER TABLE public.training_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_items"
    ON public.training_items FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_assignments ──────────────────────────────────────────────────
-- Assigns a module to participants of an event by Event Participation Role
-- (FR-COM-10: "Training can be assigned to Event Participation Roles"). A module
-- can be mandatory or optional, with an optional completion deadline that drives
-- reminders/escalation (wired to scheduled jobs in a later phase).
CREATE TABLE IF NOT EXISTS public.training_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id     uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  event_ref     text NOT NULL,                 -- Sanity event/campaign _id
  event_role    text NOT NULL,                 -- members.event_role enum value, or 'all'
  is_mandatory  boolean NOT NULL DEFAULT false,
  due_at        timestamptz,
  created_by    uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, event_ref, event_role)
);

CREATE INDEX IF NOT EXISTS training_assignments_event_idx
  ON public.training_assignments(event_ref, event_role);

ALTER TABLE public.training_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_assignments"
    ON public.training_assignments FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_progress ─────────────────────────────────────────────────────
-- One row per member per item. Absence = not started. Lets members, teachers,
-- Student Managers, and admins all see completion at the item and module level.
CREATE TABLE IF NOT EXISTS public.training_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES public.training_items(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'in_progress'
                  CHECK (status IN ('in_progress', 'completed')),
  completed_at  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, item_id)
);

CREATE INDEX IF NOT EXISTS training_progress_member_idx
  ON public.training_progress(member_id);
CREATE INDEX IF NOT EXISTS training_progress_item_idx
  ON public.training_progress(item_id);

ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_progress"
    ON public.training_progress FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── member_notification_prefs ─────────────────────────────────────────────
-- Per-member delivery preferences across channels (FR-COM-06 + the Training/
-- Mentoring/Coaching stories that ask for "email or SMS" reminders).
--
-- SMS to minors requires documented consent (TCPA): sms_enabled stays false until
-- sms_consent_at is set, and for under-18 members the consenting party is the
-- parent/guardian (captured at registration). The SMS sender is stubbed until the
-- provider (Twilio) and A2P 10DLC registration are live.
CREATE TABLE IF NOT EXISTS public.member_notification_prefs (
  member_id       uuid PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  inapp_enabled   boolean NOT NULL DEFAULT true,
  email_enabled   boolean NOT NULL DEFAULT true,
  sms_enabled     boolean NOT NULL DEFAULT false,
  sms_number      text,
  sms_consent_at  timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.member_notification_prefs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access member_notification_prefs"
    ON public.member_notification_prefs FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── training_progress count helper ────────────────────────────────────────
-- Atomic upsert used by the progress API to mark an item complete/in-progress.
CREATE OR REPLACE FUNCTION public.set_training_progress(
  p_member_id uuid,
  p_item_id   uuid,
  p_status    text
)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.training_progress (member_id, item_id, status, completed_at, updated_at)
  VALUES (
    p_member_id,
    p_item_id,
    p_status,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (member_id, item_id) DO UPDATE
    SET status = EXCLUDED.status,
        completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN now() ELSE NULL END,
        updated_at = now();
$$;
