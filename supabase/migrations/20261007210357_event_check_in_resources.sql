-- Event check-in v2 (CO feedback, 7 Oct 2026): the participant's check-in page
-- links to the event's shared Google Docs folder. One link per event, set by an
-- admin or the event manager on the check-in console. Nullable: no link, no
-- button. Additive; event_settings is service-role only (RLS policy in 023).
ALTER TABLE public.event_settings
  ADD COLUMN IF NOT EXISTS resources_url text
    CHECK (resources_url IS NULL OR resources_url ~ '^https://');
