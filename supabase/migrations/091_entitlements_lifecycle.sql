-- =====================================================================
-- 091_entitlements_lifecycle.sql
-- Additive. The grant / re-grant / revert lifecycle for the entitlements
-- ledger, keyed off the EXISTING public.member_memberships record (no parallel
-- memberships table). One grant function serves both the Stripe webhook
-- (on activation) and the daily cron (per-period re-grant); a revert sweep
-- expires granted lots when a membership lapses. Idempotent per
-- (membership, benefit, period) so retries and overlapping cron ticks never
-- double-grant. Purchased lots are never touched.
-- =====================================================================

-- Period bucket start for a benefit ('per_term' approximated to quarter).
create or replace function entitlements.fn_period_start(p_period text, p_as_of timestamptz, p_started timestamptz)
returns date language sql immutable as $$
  select case p_period
           when 'one_off'   then p_started::date
           when 'monthly'   then date_trunc('month',   p_as_of)::date
           when 'quarterly' then date_trunc('quarter', p_as_of)::date
           when 'per_term'  then date_trunc('quarter', p_as_of)::date
           else p_started::date
         end;
$$;

-- Map an entitlement kind to the offering_type it scopes against.
create or replace function entitlements.fn_kind_to_offering(p_kind entitlements.entitlement_kind)
returns entitlements.offering_type language sql immutable as $$
  select case p_kind
           when 'coaching_session' then 'coaching_session'::entitlements.offering_type
           when 'cohort_access'    then 'mentoring_cohort'::entitlements.offering_type
           when 'call_series'      then 'call_series'::entitlements.offering_type
           when 'training_access'  then 'training_content'::entitlements.offering_type
           else null
         end;
$$;

-- Idempotency ledger for grants (member-keyed analogue of the handover's
-- entitlement_grant_runs).
create table entitlements.member_grant_runs (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  membership_id   uuid not null references public.member_memberships(id) on delete cascade,
  tier_benefit_id uuid not null references entitlements.tier_benefits(id) on delete cascade,
  period_start    date not null,
  entitlement_id  uuid references entitlements.entitlements(id),
  granted_at      timestamptz not null default now(),
  unique (membership_id, tier_benefit_id, period_start)
);
alter table entitlements.member_grant_runs enable row level security;

-- Materialise the active tier's allocations for one membership's current period.
-- Returns the number of new entitlement lots created.
create or replace function entitlements.fn_grant_member_benefits(p_membership uuid, p_as_of timestamptz default now())
returns integer language plpgsql security definer set search_path = entitlements, public as $$
declare
  mm      record;
  v_tier  text;
  tb      entitlements.tier_benefits%rowtype;
  v_period date;
  v_new    integer;
  v_ent    uuid;
  v_count  integer := 0;
begin
  select member_id, tier_id, started_at, expires_at, renewal_status
    into mm from public.member_memberships where id = p_membership;
  if mm.member_id is null then raise exception 'membership % not found', p_membership; end if;
  if mm.renewal_status <> 'active' then return 0; end if;

  select code into v_tier from entitlements.tiers where membership_tier_id = mm.tier_id;
  if v_tier is null then return 0; end if;

  for tb in
    select * from entitlements.tier_benefits where tier_code = v_tier and kind is not null
  loop
    v_period := entitlements.fn_period_start(tb.period, p_as_of, mm.started_at::timestamptz);

    insert into entitlements.member_grant_runs(member_id, membership_id, tier_benefit_id, period_start)
    values (mm.member_id, p_membership, tb.id, v_period)
    on conflict (membership_id, tier_benefit_id, period_start) do nothing;
    get diagnostics v_new = row_count;
    if v_new = 0 then continue; end if;

    insert into entitlements.entitlements(
      member_id, kind, scope_type, offering_type,
      quantity_total, quantity_remaining, source, source_ref,
      refundable, status, valid_from, expires_at)
    values (
      mm.member_id, tb.kind, 'offering_type', entitlements.fn_kind_to_offering(tb.kind),
      tb.quantity, tb.quantity, 'tier_grant',
      p_membership::text || ':' || tb.id::text || ':' || v_period::text,
      false, 'active', now(),
      case when tb.validity_days is not null then now() + (tb.validity_days || ' days')::interval
           when mm.expires_at is not null then mm.expires_at::timestamptz
           else null end)
    returning id into v_ent;

    update entitlements.member_grant_runs set entitlement_id = v_ent
      where membership_id = p_membership and tier_benefit_id = tb.id and period_start = v_period;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- CRON: re-grant the current period's allowance for every active membership.
-- A no-op until a new period bucket opens, so daily runs are safe and cheap.
create or replace function entitlements.fn_regrant_periodic()
returns integer language plpgsql security definer set search_path = entitlements, public as $$
declare r record; v_n integer := 0;
begin
  for r in
    select id from public.member_memberships
     where renewal_status = 'active' and (expires_at is null or expires_at >= current_date)
  loop
    v_n := v_n + entitlements.fn_grant_member_benefits(r.id, now());
  end loop;
  return v_n;
end $$;

-- CRON: expire granted (not purchased) lots whose source membership has lapsed
-- (no longer active, or past its expiry). Returns rows expired.
create or replace function entitlements.fn_expire_lapsed_grants()
returns integer language plpgsql security definer set search_path = entitlements, public as $$
declare v_n integer;
begin
  with lapsed as (
    update entitlements.entitlements e set status = 'expired'
    from public.member_memberships mm
    where e.status = 'active' and e.source = 'tier_grant'
      and mm.id = nullif(split_part(e.source_ref, ':', 1), '')::uuid
      and (mm.renewal_status <> 'active'
           or (mm.expires_at is not null and mm.expires_at < current_date))
    returning e.id
  )
  select count(*)::int into v_n from lapsed;
  return v_n;
end $$;
