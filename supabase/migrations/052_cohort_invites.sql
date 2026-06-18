-- Migration 052: cohort invite / accept (PRD §11 — "accept an invite into a Cohort").
--
-- Members added to a cohort start as 'invited' and gain access to its content
-- (chat, recordings, training, sessions) only after they accept. Existing rows
-- default to 'active' so there is no regression for current cohort members.

alter table public.cohort_members
  add column if not exists status text not null default 'active'
    check (status in ('invited', 'active')),
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz;

-- Treat pre-existing memberships as already accepted.
update public.cohort_members
  set accepted_at = coalesce(accepted_at, added_at)
  where status = 'active' and accepted_at is null;
