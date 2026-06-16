-- Migration 046: Per-member activity log (audit trail).
--
-- One append-only table that records every meaningful action taken against a
-- member's profile — membership grants/edits/removals, profile edits, account
-- lifecycle, event participation, billing, DocuSign, community and school links.
--
-- The log is *fully shared*: a member sees exactly the same entries an admin
-- sees on the member's admin page, so there is intentionally no visibility flag.
-- All reads/writes go through service-role server routes (lib/activity-log.ts),
-- so RLS mirrors the rest of the schema: service role full access, no public
-- policy. Writes are best-effort and must never block the originating action.
--
-- Conventions follow prior migrations: IF NOT EXISTS guards, gen_random_uuid()
-- PKs, service-role RLS.

CREATE TABLE IF NOT EXISTS public.member_activity_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id        uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,

  -- Who performed it. actor_member_id is the acting admin/member when known;
  -- actor_label is a denormalised name/email snapshot so the entry still reads
  -- well if that member row is later removed.
  actor_type       text NOT NULL DEFAULT 'system'
                     CHECK (actor_type IN ('admin', 'member', 'system', 'stripe', 'docusign')),
  actor_member_id  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  actor_label      text,

  -- What happened. category groups entries in the UI; action is the machine key
  -- (e.g. 'tier_granted'); summary is the human sentence shown to the reader.
  category         text NOT NULL
                     CHECK (category IN ('membership', 'profile', 'account', 'event',
                                         'billing', 'docusign', 'community', 'school')),
  action           text NOT NULL,
  summary          text NOT NULL,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_activity_log_member_idx
  ON public.member_activity_log (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS member_activity_log_category_idx
  ON public.member_activity_log (category);

ALTER TABLE public.member_activity_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access member_activity_log"
    ON public.member_activity_log FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
