-- deep review MEM-15 (data retention) — UNAPPLIED; needs dev → prod.
--
-- Removing a participant from a team hard-deletes the participants row. Four FKs
-- that point at participants are ON DELETE CASCADE, so that delete also erases:
--   • event_award_assignments  (judging awards — the credential's referent)
--   • survey_invitations        (post-event survey recipients)
--   • survey_responses          (submitted survey answers — 7-year retention)
--   • team_profiles             (the pre-event team profile + its answer history)
-- Policy keeps award and survey data for 7 years, so a routine roster edit must
-- not be able to destroy it. Flip these FKs to ON DELETE SET NULL: the retained
-- rows survive a participant deletion, detached rather than erased. The issued
-- credential already uses SET NULL (20260921120000_credentials.sql) — this makes
-- the award it references survive too.
--
-- The participant_id columns on event_award_assignments and team_profiles are
-- NOT NULL today, so SET NULL also requires dropping that constraint. team_profiles
-- keeps its UNIQUE(participant_id) — Postgres permits multiple NULLs in a unique
-- index, so detached rows coexist.
--
-- No SECURITY DEFINER function and no new table are added, so no REVOKE/RLS block
-- is required. Each DO block drops whatever FK currently sits on the column (by
-- its real name) so the ADD cannot leave a second, stricter constraint behind;
-- re-running drops the SET NULL one and re-adds it (idempotent).

-- 1. event_award_assignments.participant_id: NOT NULL → nullable, CASCADE → SET NULL.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = 'event_award_assignments'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'participant_id')]
  LOOP
    EXECUTE format('ALTER TABLE public.event_award_assignments DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.event_award_assignments ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.event_award_assignments
  ADD CONSTRAINT event_award_assignments_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

-- 2. survey_invitations.participant_id: already nullable, CASCADE → SET NULL.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = 'survey_invitations'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'participant_id')]
  LOOP
    EXECUTE format('ALTER TABLE public.survey_invitations DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.survey_invitations
  ADD CONSTRAINT survey_invitations_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

-- 3. survey_responses.participant_id: already nullable, CASCADE → SET NULL.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = 'survey_responses'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'participant_id')]
  LOOP
    EXECUTE format('ALTER TABLE public.survey_responses DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.survey_responses
  ADD CONSTRAINT survey_responses_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;

-- 4. team_profiles.participant_id: NOT NULL UNIQUE → nullable UNIQUE, CASCADE → SET NULL.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE con.contype = 'f' AND nsp.nspname = 'public' AND rel.relname = 'team_profiles'
      AND con.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = rel.oid AND attname = 'participant_id')]
  LOOP
    EXECUTE format('ALTER TABLE public.team_profiles DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.team_profiles ALTER COLUMN participant_id DROP NOT NULL;
ALTER TABLE public.team_profiles
  ADD CONSTRAINT team_profiles_participant_id_fkey
  FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE SET NULL;
