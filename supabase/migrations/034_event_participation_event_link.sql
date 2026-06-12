-- 034: Link event_participations to the registered event.
--
-- event_participations historically modelled member-logged historical activity
-- (year / location / team / award). Registrations now ALSO write a row here so
-- the just-registered event appears in the "Event Activity" lists on the member
-- portal, the admin member page, and the read-only view-as page — those all read
-- event_participations, NOT registrations/participants, which is why a fresh
-- registration was invisible there.
--
-- To identify and de-duplicate the auto-created rows we record the event slug +
-- title (member-logged rows keep these NULL). This also makes real the
-- dependency the deletion registry already declares (event -> event_participations
-- via event_slug). Additive + idempotent.

ALTER TABLE public.event_participations
  ADD COLUMN IF NOT EXISTS event_slug  text,
  ADD COLUMN IF NOT EXISTS event_title text;

COMMENT ON COLUMN public.event_participations.event_slug IS
  'Set on rows auto-created from a registration; NULL for member-logged historical activity.';

-- At most one auto-created participation per member per event. Member-logged
-- rows (event_slug NULL) are unaffected by the partial index.
CREATE UNIQUE INDEX IF NOT EXISTS event_participations_member_event_uniq
  ON public.event_participations (member_id, event_slug)
  WHERE event_slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_participations_event_slug_idx
  ON public.event_participations (event_slug);
