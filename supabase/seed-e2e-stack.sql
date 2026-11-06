-- seed-e2e-stack.sql: rows the e2e suite needs that supabase/seed.sql does not
-- carry, for the disposable stack only (`e2e-local` in .github/workflows/ci.yml).
-- Never applied to the dev project, where the real rows already exist and this
-- slug is shared with manual testing.
--
-- pd-credentials.spec and mentor-credentials.spec issue credentials on this event.
-- It is not in Sanity in CI, so the routes name it from its registration, and the
-- mentor spec rosters on the event's container.

begin;

insert into public.registrations (id, event_slug, event_title, type, status)
values ('00000000-0000-4000-d000-000000000003', 'nevada-space-design-challenge',
        'Nevada Space Design Challenge', 'individual', 'confirmed');

insert into public.mentoring_cohorts (id, name, theme, container_type, campaign_ref, lifecycle, is_active)
values ('00000000-0000-4000-d100-000000000001', 'Nevada Space Design Challenge', 'space',
        'event_participation', 'nevada-space-design-challenge', 'active', true);

insert into public.event_settings (event_slug)
values ('nevada-space-design-challenge');

commit;
