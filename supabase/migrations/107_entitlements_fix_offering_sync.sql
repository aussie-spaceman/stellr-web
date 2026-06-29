-- 107_entitlements_fix_offering_sync.sql
-- Entitlements cutover · Phase 2 — fix the offering sync (prerequisite for the coaching flip).
--
-- fn_sync_cohort_offerings mapped EVERY mentoring_cohorts row to a 'mentoring_cohort' offering,
-- including non-academy containers (training/space/event_participation/campaign_participation)
-- and — when they exist — coaching workshops (which must be 'coaching_session'). Fix the mapping
-- by container_type, and remove the wrongly-synced non-academy offerings (none have bookings).
--
-- container_type → offering_type:  mentoring → mentoring_cohort ; coaching|workshop → coaching_session
-- (space/training/event_participation/campaign_participation are NOT academy bookables → no offering)

create or replace function entitlements.fn_sync_cohort_offerings()
  returns integer language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
declare v_n integer;
begin
  with ins as (
    insert into entitlements.offerings (type, cohort_id, title, capacity, status)
    select case c.container_type
             when 'mentoring' then 'mentoring_cohort'::entitlements.offering_type
             when 'coaching'  then 'coaching_session'::entitlements.offering_type
             when 'workshop'  then 'coaching_session'::entitlements.offering_type
           end,
           c.id, c.name, null,
           case when c.is_active and c.archived_at is null then 'open' else 'completed' end
    from public.mentoring_cohorts c
    where c.container_type in ('mentoring', 'coaching', 'workshop')
      and not exists (select 1 from entitlements.offerings o where o.cohort_id = c.id)
    returning 1
  )
  select count(*)::int into v_n from ins;
  return v_n;
end $function$;

-- Remove offerings wrongly created for non-academy containers (no bookings reference them).
delete from entitlements.offerings o
 where exists (select 1 from public.mentoring_cohorts c
                where c.id = o.cohort_id and c.container_type not in ('mentoring', 'coaching', 'workshop'))
   and not exists (select 1 from entitlements.bookings b where b.offering_id = o.id);
