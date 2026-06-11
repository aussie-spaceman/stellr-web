-- Migration 026: Deletion subsystem
--
-- Backs the admin database-cleanup feature. Two tables:
--   * deletion_archive  — JSON snapshot written before a hard purge so support
--                         can recover data (the "recoverable by support" path).
--   * deletion_requests — member-initiated deletion requests (event activity,
--                         school removal, coaching/mentoring sessions) routed
--                         through the Activity Review Log for admin approval.
--
-- Both are admin/service-role only; RLS mirrors the rest of the schema (service
-- role full access, no public policies). Soft-delete columns for core tables
-- (members.deleted_at, etc.) already exist or must be audited directly in
-- Supabase — they are intentionally not (re)created here.

-- ---------------------------------------------------------------------------
-- deletion_archive
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletion_archive (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  snapshot     jsonb NOT NULL,
  deleted_by   uuid REFERENCES public.members(id) ON DELETE SET NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deletion_archive_entity_idx
  ON public.deletion_archive (entity_type, entity_id);

ALTER TABLE public.deletion_archive ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access deletion_archive"
    ON public.deletion_archive FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- deletion_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deletion_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by  uuid REFERENCES public.members(id) ON DELETE SET NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  reason        text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note   text,
  reviewed_by   uuid REFERENCES public.members(id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deletion_requests_status_idx
  ON public.deletion_requests (status, created_at);

CREATE INDEX IF NOT EXISTS deletion_requests_requester_idx
  ON public.deletion_requests (requested_by);

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service role full access deletion_requests"
    ON public.deletion_requests FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
