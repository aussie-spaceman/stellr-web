-- Migration 068: Training portal redesign (member + admin).
--
-- Adds the data the redesigned Training section needs that the existing schema
-- (017/019/020/045/050/065) does not yet carry:
--   1. training_modules.theme              — visual/content theme (Space/Enviro/Campaign)
--   2. training_modules.remind_* / escalate_supervisor — PER-COURSE reminder &
--      escalation settings (the cron currently hard-codes 7d/1d for everything).
--   3. training_modules.cert_template_path — optional uploaded certificate PDF template.
--   4. course_object_assignments           — assign a course to ANY Object type
--      (competition/campaign/cohort/workshop/space) with per-membership-tier
--      requirements (mandatory/optional/n-a). Supersedes the simple, event-only,
--      single-boolean training_assignments for the new Course builder. The old
--      table is kept live so the event Training tab + cron keep working; the
--      member data layer reads BOTH (see lib/training.ts).
--   5. training_certificates               — auto-issued on 100% completion.
--
-- Requirement is stored on the Course<->Object assignment, keyed by membership
-- tier — NOT on the Course (Training Scope domain model). Because the real tier
-- ladder is age-bracket-dependent and far richer than the prototype's 3 example
-- names, per-tier requirements are stored data-driven (JSONB keyed by tier id),
-- with a per-assignment default for tiers not explicitly set.

-- ─── 1–3. training_modules additions ────────────────────────────────────────
ALTER TABLE public.training_modules
  ADD COLUMN IF NOT EXISTS theme text
    CHECK (theme IS NULL OR theme IN ('space', 'environmental', 'campaign')),
  -- Per-course delivery channels (at least one required for mandatory training;
  -- enforced in the admin UI). Defaults preserve today's behaviour (in-app+email).
  ADD COLUMN IF NOT EXISTS remind_inapp        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_email        boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_sms          boolean NOT NULL DEFAULT false,
  -- Per-course reminder schedule. Defaults mirror the legacy cron (1 week + 1 day).
  ADD COLUMN IF NOT EXISTS remind_2wk          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind_1wk          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remind_2d           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS remind_1d           boolean NOT NULL DEFAULT true,
  -- Escalate overdue mandatory training to the supervising adult (Teacher / SM).
  ADD COLUMN IF NOT EXISTS escalate_supervisor boolean NOT NULL DEFAULT true,
  -- Optional uploaded certificate template (private bucket storage path). When
  -- set, the member's certificate download serves this PDF; else a default is
  -- generated.
  ADD COLUMN IF NOT EXISTS cert_template_path  text;

-- ─── 4. course_object_assignments ───────────────────────────────────────────
-- A course assigned to one Object, with per-tier requirements. object_ref points
-- at the Object's primary id by type:
--   competition / campaign → Sanity event _id
--   cohort / workshop / space → mentoring_cohorts.id (container_type distinguishes)
CREATE TABLE IF NOT EXISTS public.course_object_assignments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id           uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  object_type         text NOT NULL
                        CHECK (object_type IN ('competition', 'campaign', 'cohort', 'workshop', 'space')),
  object_ref          text NOT NULL,
  -- Denormalised display label for the Object (avoids a Sanity/cohort round-trip
  -- when listing assignments in the builder). Refreshed on write.
  object_label        text,
  -- Requirement applied to tiers without an explicit override below.
  default_requirement text NOT NULL DEFAULT 'optional'
                        CHECK (default_requirement IN ('mandatory', 'optional', 'na')),
  -- Per-tier overrides: { "<membership_tier_id>": "mandatory" | "optional" | "na" }.
  -- Empty means every tier inherits default_requirement.
  tier_requirements   jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Optional completion deadline driving reminders/escalation for this Object.
  due_at              timestamptz,
  created_by          uuid REFERENCES public.members(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, object_type, object_ref)
);

CREATE INDEX IF NOT EXISTS course_object_assignments_module_idx
  ON public.course_object_assignments(module_id);
CREATE INDEX IF NOT EXISTS course_object_assignments_object_idx
  ON public.course_object_assignments(object_type, object_ref);

ALTER TABLE public.course_object_assignments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access course_object_assignments"
    ON public.course_object_assignments FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── 5. training_certificates ───────────────────────────────────────────────
-- One certificate per member per course, auto-issued when the member completes
-- every published lesson (see /api/community/training/progress). cert_number is a
-- short, human-quotable code; issuer is captured at issue time for a stable PDF.
CREATE TABLE IF NOT EXISTS public.training_certificates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  module_id    uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  cert_number  text NOT NULL,
  issuer       text NOT NULL DEFAULT 'Stellr Education',
  issued_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, module_id)
);

CREATE INDEX IF NOT EXISTS training_certificates_member_idx
  ON public.training_certificates(member_id);

ALTER TABLE public.training_certificates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access training_certificates"
    ON public.training_certificates FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
