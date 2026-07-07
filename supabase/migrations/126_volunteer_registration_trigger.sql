-- Volunteer-registration grant trigger.
--
-- Adds a dedicated 'volunteer_registration' trigger_type so access/grant rules can
-- fire when a member joins the volunteer program (lib/volunteer.ts grantVolunteerRole),
-- rather than overloading the legacy 'mentor_at_event' trigger. The admin Access
-- Rules editor surfaces this as "Registered as a volunteer".

ALTER TABLE public.tier_grant_rules DROP CONSTRAINT IF EXISTS tier_grant_rules_trigger_type_check;
ALTER TABLE public.tier_grant_rules
  ADD CONSTRAINT tier_grant_rules_trigger_type_check CHECK (trigger_type IN (
    'signup', 'event_attendance', 'event_award', 'mentor_at_event',
    'subscribe_website', 'graduation', 'manual', 'campaign_enrollment',
    'competition_registration', 'tier_purchased', 'object_created',
    'volunteer_registration'));
