-- 127_space_training_bracket_requirements.sql
-- ---------------------------------------------------------------------------
-- Per age-bracket mandatory + deadline for training assigned to a Space.
--
-- Until now `community_space_training` carried a single `is_mandatory` boolean
-- and no deadline. Admins need to mark a course mandatory for specific age
-- brackets (adult / high_school / college) and set a completion deadline that
-- can differ per bracket. `bracket_requirements` stores those overrides:
--
--   {
--     "high_school": { "mandatory": true,  "due_at": "2026-09-01" },
--     "college":     { "mandatory": false, "due_at": null },
--     "adult":       { "mandatory": true,  "due_at": "2026-10-15" }
--   }
--
-- Resolution for a member: look up their age_bracket key. If present, its
-- `mandatory`/`due_at` win. If absent, fall back to the legacy `is_mandatory`
-- boolean (kept as a rollup: true when any bracket is mandatory) with no
-- deadline. Existing rows default to '{}' → behaviour is unchanged.
-- ---------------------------------------------------------------------------

alter table public.community_space_training
  add column if not exists bracket_requirements jsonb not null default '{}'::jsonb;

comment on column public.community_space_training.bracket_requirements is
  'Per age-bracket overrides. Keys: adult|high_school|college. Value: {"mandatory":bool,"due_at":date|null}. Absent bracket falls back to is_mandatory with no deadline.';
