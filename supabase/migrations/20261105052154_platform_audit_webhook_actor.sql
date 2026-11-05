-- S5 C7: platform_audit_events accepts a webhook actor (docs/TENANCY-S5.md, C7).
--
-- The table took 'user', 'system' and 'cron' only, so a row with the actor
-- 'webhook:<provider>' failed the CHECK and audit() recorded the refusal instead
-- of the event. This adds the fourth kind and its actor shape. Existing kinds keep
-- their exact rules, so every row the old constraints accepted still passes.
--
-- The hash is unaffected: platform_audit_canonical() already covers actor and
-- actor_kind as text, so the form stays 'pae1' and existing chains still verify.
--
-- Widening only. Nothing writes this kind until PLATFORM_AUDIT_ENABLED=true, which
-- is off by default. The append-only triggers fire on row changes, not on a
-- constraint change or its validation, and the table owner may do both.

ALTER TABLE public.platform_audit_events
  DROP CONSTRAINT IF EXISTS platform_audit_events_actor_kind_check,
  DROP CONSTRAINT IF EXISTS platform_audit_events_actor_check;

ALTER TABLE public.platform_audit_events
  ADD CONSTRAINT platform_audit_events_actor_kind_check
    CHECK (actor_kind IN ('user', 'system', 'cron', 'webhook')) NOT VALID,
  ADD CONSTRAINT platform_audit_events_actor_check CHECK (
    (actor_kind = 'system' AND actor = 'system')
    OR (actor_kind = 'cron' AND actor ~ '^cron:[a-z0-9][a-z0-9._-]{0,62}$')
    OR (actor_kind = 'user' AND actor ~ '^user_[A-Za-z0-9]{1,64}$')
    OR (actor_kind = 'webhook' AND actor ~ '^webhook:[a-z0-9_-]{1,32}$')
  ) NOT VALID;

ALTER TABLE public.platform_audit_events VALIDATE CONSTRAINT platform_audit_events_actor_kind_check;
ALTER TABLE public.platform_audit_events VALIDATE CONSTRAINT platform_audit_events_actor_check;

COMMENT ON COLUMN public.platform_audit_events.actor IS
  'A Clerk user id (actor_kind user), ''system'', ''cron:<job>'' or ''webhook:<provider>''.';
