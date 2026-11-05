-- A roster row whose details were copied from a member's own record, because the
-- slot was linked by Stellr Member ID. Organisers see that row's name and status,
-- and cannot read or change the rest (lib/team-linked-details.ts).
--
-- Rows already on the roster stay false, since nothing recorded how they were
-- filled in. member_id and membership_id cannot tell: every row can carry both.
--
-- Additive, with a constant default, so no table rewrite. lock_timeout: fail fast
-- rather than queue registration behind this migration.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS details_from_member boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.participants.details_from_member IS
  'True when the row was filled from the member''s own record through a Member ID link. Organisers do not see or edit those details.';
