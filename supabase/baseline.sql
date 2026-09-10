--
-- PostgreSQL database dump
--

\restrict XwGn1zVO1hXSn7NADH84dp55IsiUPHjInhYDKWi7075NuvWdhYKKIgUCdZKEf3x

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: entitlements; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA entitlements;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: booking_status; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.booking_status AS ENUM (
    'reserved',
    'attended',
    'no_show',
    'cancelled'
);


--
-- Name: credit_reason; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.credit_reason AS ENUM (
    'cohort_cancellation',
    'refund',
    'goodwill',
    'adjustment',
    'redemption'
);


--
-- Name: entitlement_kind; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.entitlement_kind AS ENUM (
    'coaching_session',
    'cohort_access',
    'call_series',
    'training_access',
    'generic'
);


--
-- Name: entitlement_status; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.entitlement_status AS ENUM (
    'active',
    'consumed',
    'expired',
    'refunded'
);


--
-- Name: grant_source; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.grant_source AS ENUM (
    'purchased',
    'competition_auto',
    'award_auto',
    'volunteer_unlock',
    'admin',
    'tier_grant'
);


--
-- Name: offering_type; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.offering_type AS ENUM (
    'coaching_session',
    'mentoring_cohort',
    'call_series',
    'training_content'
);


--
-- Name: scope_type; Type: TYPE; Schema: entitlements; Owner: -
--

CREATE TYPE entitlements.scope_type AS ENUM (
    'specific_offering',
    'offering_type',
    'generic'
);


--
-- Name: age_bracket_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.age_bracket_type AS ENUM (
    'high_school',
    'college',
    'adult'
);


--
-- Name: audit_action_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_action_type AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE'
);


--
-- Name: event_role_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.event_role_type AS ENUM (
    'participant',
    'mentor',
    'teacher',
    'donor',
    'parent',
    'subscriber',
    'adult',
    'school_student_manager',
    'volunteer'
);


--
-- Name: gender_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.gender_type AS ENUM (
    'male',
    'female',
    'other',
    'prefer_not_to_say'
);


--
-- Name: grade_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grade_type AS ENUM (
    'grade_9',
    'grade_10',
    'grade_11',
    'grade_12',
    'college_freshman',
    'college_sophomore',
    'college_junior',
    'college_senior',
    'grad_phd'
);


--
-- Name: member_role_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.member_role_type AS ENUM (
    'staff',
    'coach',
    'mentor',
    'moderator',
    'student_manager',
    'teacher',
    'member',
    'participant',
    'volunteer',
    'donor_sponsor',
    'parent'
);


--
-- Name: membership_renewal_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.membership_renewal_status AS ENUM (
    'active',
    'pending_renewal',
    'expired',
    'cancelled',
    'complimentary'
);


--
-- Name: tshirt_size_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tshirt_size_type AS ENUM (
    'S',
    'M',
    'L',
    'XL',
    '2XL',
    '3XL_plus',
    '3XL (or larger)'
);


--
-- Name: fn_active_tier(uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_active_tier(p_member uuid) RETURNS text
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select t.code
  from public.member_memberships mm
  join entitlements.tiers t on t.membership_tier_id = mm.tier_id
  where mm.member_id = p_member
    and (mm.expires_at is null or mm.expires_at >= current_date)
  order by mm.started_at desc limit 1;
$$;


--
-- Name: fn_allocation_balance(uuid, entitlements.entitlement_kind, uuid, entitlements.offering_type); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_allocation_balance(p_member uuid, p_kind entitlements.entitlement_kind, p_offering uuid DEFAULT NULL::uuid, p_offering_type entitlements.offering_type DEFAULT NULL::entitlements.offering_type) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select coalesce(sum(quantity_remaining),0)::int
  from entitlements.entitlements
  where member_id = p_member and kind = p_kind and status = 'active'
    and valid_from <= now() and (expires_at is null or expires_at > now())
    and ( scope_type = 'generic'
       or (scope_type = 'specific_offering' and offering_id = p_offering)
       or (scope_type = 'offering_type'     and offering_type = p_offering_type) );
$$;


--
-- Name: fn_base_price_cents(uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_base_price_cents(p_offering uuid) RETURNS integer
    LANGUAGE plpgsql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
declare o entitlements.offerings%rowtype; v integer;
begin
  select * into o from entitlements.offerings where id = p_offering;
  select amount_cents into v from entitlements.prices
   where offering_id = p_offering and valid_from <= now() and (valid_to is null or valid_to > now())
   order by valid_from desc limit 1;
  if v is not null then return v; end if;
  select amount_cents into v from entitlements.prices
   where offering_type = o.type and segment = o.segment and valid_from <= now() and (valid_to is null or valid_to > now())
   order by valid_from desc limit 1;
  if v is not null then return v; end if;
  select amount_cents into v from entitlements.prices
   where offering_type = o.type and segment is null and valid_from <= now() and (valid_to is null or valid_to > now())
   order by valid_from desc limit 1;
  return v;
end $$;


--
-- Name: fn_book_from_allocation(uuid, uuid, uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare
  o entitlements.offerings%rowtype;
  v_kind entitlements.entitlement_kind;
  v_needed int := 1;
  v_left int;
  v_take int;
  v_ids uuid[] := '{}';
  v_takes int[] := '{}';
  lot record;
  b_id uuid;
  i int;
begin
  select * into o from entitlements.offerings where id = p_offering for update;
  if o.status <> 'open' then raise exception 'Offering % not open', p_offering; end if;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;
  if o.type = 'mentoring_cohort' then
    select greatest(1, coalesce(mc.planned_sessions, 1)) into v_needed from public.mentoring_cohorts mc where mc.id = o.cohort_id;
  else
    v_needed := 1;
  end if;

  -- Collect eligible lots FIFO until the needed quantity is covered (locks each
  -- lot; a concurrent draw on the same lots is skipped, not blocked).
  v_left := v_needed;
  for lot in
    select id, quantity_remaining from entitlements.entitlements
     where member_id = p_member and kind = v_kind and status = 'active'
       and quantity_remaining > 0 and valid_from <= now() and (expires_at is null or expires_at > now())
       and ( scope_type = 'generic'
          or (scope_type = 'specific_offering' and offering_id = p_offering)
          or (scope_type = 'offering_type' and offering_type = o.type) )
     order by expires_at nulls last, created_at
     for update skip locked
  loop
    v_take := least(lot.quantity_remaining, v_left);
    v_ids := v_ids || lot.id;
    v_takes := v_takes || v_take;
    v_left := v_left - v_take;
    exit when v_left = 0;
  end loop;
  if v_left > 0 then raise exception 'No included allocation available'; end if;

  if o.type = 'mentoring_cohort' and o.capacity is not null then
    if o.seats_taken >= o.capacity then raise exception 'Cohort full'; end if;
    update entitlements.offerings set seats_taken = seats_taken + 1,
           status = case when seats_taken + 1 >= capacity then 'full' else status end
     where id = p_offering;
  end if;

  for i in 1..coalesce(array_length(v_ids, 1), 0) loop
    update entitlements.entitlements
       set quantity_remaining = quantity_remaining - v_takes[i],
           status = case when quantity_remaining - v_takes[i] <= 0 then 'consumed' else status end
     where id = v_ids[i];
  end loop;

  insert into entitlements.bookings(member_id, offering_id, consumed_entitlement_id, amount_charged_cents, status)
  values (p_member, p_offering, v_ids[1], 0, 'reserved')
  returning id into b_id;
  return b_id;
end $$;


--
-- Name: fn_cancel_cohort(uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_cancel_cohort(p_offering uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare b entitlements.bookings%rowtype; o entitlements.offerings%rowtype; v_restore int;
begin
  select * into o from entitlements.offerings where id = p_offering;
  if o.type = 'mentoring_cohort' then
    select greatest(1, coalesce(mc.planned_sessions, 1)) into v_restore
      from public.mentoring_cohorts mc where mc.id = o.cohort_id;
  else
    v_restore := 1;
  end if;
  for b in select * from entitlements.bookings where offering_id = p_offering and status = 'reserved'
  loop
    -- Restore drawn allocations only (free/included bookings). PAID bookings
    -- (amount or credit > 0) are refunded to public.account_credits by the caller.
    if coalesce(b.amount_charged_cents, 0) = 0 and coalesce(b.credit_applied_cents, 0) = 0
       and b.consumed_entitlement_id is not null then
      update entitlements.entitlements
         set quantity_remaining = quantity_remaining + v_restore, status = 'active',
             expires_at = greatest(coalesce(expires_at, now()), now() + interval '90 days')
       where id = b.consumed_entitlement_id;
    end if;
    update entitlements.bookings set status = 'cancelled' where id = b.id;
  end loop;
  update entitlements.offerings set seats_taken = 0, status = 'cancelled' where id = p_offering;
end $$;


--
-- Name: fn_claim_event(text, text); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_claim_event(p_event_id text, p_type text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare v_new integer;
begin
  insert into entitlements.processed_events(event_id, type) values (p_event_id, p_type)
  on conflict (event_id) do nothing;
  get diagnostics v_new = row_count;
  return v_new = 1;
end $$;


--
-- Name: fn_confirm_paid_booking(uuid, uuid, text, integer, integer, uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_confirm_paid_booking(p_member uuid, p_offering uuid, p_stripe_payment text, p_amount_charged_cents integer, p_credit_applied_cents integer, p_participant uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare o entitlements.offerings%rowtype; v_kind entitlements.entitlement_kind; ent_id uuid; b_id uuid;
begin
  select * into o from entitlements.offerings where id = p_offering for update;
  if o.status <> 'open' then raise exception 'Offering % not open', p_offering; end if;
  if p_credit_applied_cents > 0 and p_credit_applied_cents > entitlements.fn_credit_balance(p_member) then
    raise exception 'Insufficient account credit';
  end if;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;
  if o.type = 'mentoring_cohort' and o.capacity is not null then
    if o.seats_taken >= o.capacity then raise exception 'Cohort full'; end if;
    update entitlements.offerings set seats_taken = seats_taken + 1,
           status = case when seats_taken + 1 >= capacity then 'full' else status end
     where id = p_offering;
  end if;
  insert into entitlements.entitlements(member_id, kind, scope_type, offering_id, quantity_total, quantity_remaining, source, source_ref, refundable, status, expires_at)
  values (p_member, v_kind, 'specific_offering', p_offering, 1, 0, 'purchased', p_stripe_payment, true, 'consumed', entitlements.fn_purchase_expiry())
  returning id into ent_id;
  if p_credit_applied_cents > 0 then
    insert into entitlements.account_credit_ledger(member_id, amount_cents, reason) values (p_member, -p_credit_applied_cents, 'redemption');
  end if;
  insert into entitlements.bookings(member_id, offering_id, consumed_entitlement_id, amount_charged_cents, credit_applied_cents, stripe_payment_id, status)
  values (p_member, p_offering, ent_id, p_amount_charged_cents, p_credit_applied_cents, p_stripe_payment, 'reserved')
  returning id into b_id;
  return b_id;
end $$;


--
-- Name: fn_credit_balance(uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_credit_balance(p_member uuid) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select coalesce(sum(amount_cents),0)::int
  from entitlements.account_credit_ledger where member_id = p_member;
$$;


--
-- Name: fn_expire_lapsed_grants(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_expire_lapsed_grants() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
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


--
-- Name: fn_grant_adhoc(uuid, entitlements.entitlement_kind, integer, text, timestamp with time zone); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_grant_adhoc(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_source_ref text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare v_id uuid;
begin
  if p_quantity <= 0 then return 0; end if;
  if exists (
    select 1 from entitlements.entitlements
     where member_id = p_member and kind = p_kind and source = 'admin' and source_ref = p_source_ref
  ) then
    return 0;
  end if;
  insert into entitlements.entitlements(
    member_id, kind, scope_type, offering_type,
    quantity_total, quantity_remaining, source, source_ref,
    refundable, status, valid_from, expires_at)
  values (
    p_member, p_kind, 'offering_type', entitlements.fn_kind_to_offering(p_kind),
    p_quantity, p_quantity, 'admin', p_source_ref,
    false, 'active', now(), p_expires_at)
  returning id into v_id;
  return p_quantity;
end $$;


--
-- Name: fn_grant_member_benefits(uuid, timestamp with time zone); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_grant_member_benefits(p_membership uuid, p_as_of timestamp with time zone DEFAULT now()) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
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


--
-- Name: fn_grant_purchased(uuid, entitlements.entitlement_kind, integer, text, timestamp with time zone); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_grant_purchased(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_stripe_session text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare v_id uuid; v_exp timestamptz;
begin
  if p_quantity <= 0 then return 0; end if;
  if exists (
    select 1 from entitlements.entitlements
     where member_id = p_member and kind = p_kind and source = 'purchased' and source_ref = p_stripe_session
  ) then
    return 0;
  end if;
  v_exp := coalesce(p_expires_at, entitlements.fn_purchase_expiry());
  insert into entitlements.entitlements(
    member_id, kind, scope_type, offering_type,
    quantity_total, quantity_remaining, source, source_ref,
    refundable, status, valid_from, expires_at)
  values (
    p_member, p_kind, 'offering_type', entitlements.fn_kind_to_offering(p_kind),
    p_quantity, p_quantity, 'purchased', p_stripe_session,
    true, 'active', now(), v_exp)
  returning id into v_id;
  return p_quantity;
end $$;


--
-- Name: fn_kind_to_offering(entitlements.entitlement_kind); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_kind_to_offering(p_kind entitlements.entitlement_kind) RETURNS entitlements.offering_type
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select case p_kind
           when 'coaching_session' then 'coaching_session'::entitlements.offering_type
           when 'cohort_access'    then 'mentoring_cohort'::entitlements.offering_type
           when 'call_series'      then 'call_series'::entitlements.offering_type
           when 'training_access'  then 'training_content'::entitlements.offering_type
           else null
         end;
$$;


--
-- Name: fn_mark_no_show(uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_mark_no_show(p_booking uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
begin
  update entitlements.bookings set status = 'no_show' where id = p_booking and status = 'reserved';
end $$;


--
-- Name: fn_period_start(text, timestamp with time zone, timestamp with time zone); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_period_start(p_period text, p_as_of timestamp with time zone, p_started timestamp with time zone) RETURNS date
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select case p_period
           when 'one_off'   then p_started::date
           when 'monthly'   then date_trunc('month',   p_as_of)::date
           when 'quarterly' then date_trunc('quarter', p_as_of)::date
           when 'per_term'  then date_trunc('quarter', p_as_of)::date
           else p_started::date
         end;
$$;


--
-- Name: fn_purchase_expiry(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_purchase_expiry() RETURNS timestamp with time zone
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$ select null::timestamptz; $$;


--
-- Name: fn_quote(uuid, uuid, text); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_quote(p_member uuid, p_offering uuid, p_coupon text DEFAULT NULL::text) RETURNS TABLE(included_available boolean, base_cents integer, tier_discount_pct numeric, after_tier_cents integer, coupon_code text, coupon_applied boolean, coupon_discount_cents integer, net_cents integer, credit_available integer, payable_cents integer)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
declare
  o entitlements.offerings%rowtype;
  v_kind entitlements.entitlement_kind;
  v_base int; v_tier numeric; v_after int;
  c entitlements.discounts; v_coupon_cut int := 0; v_applied boolean := false;
  v_net int; v_credit int;
begin
  select * into o from entitlements.offerings where id = p_offering;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;

  if entitlements.fn_allocation_balance(p_member, v_kind, p_offering, o.type) > 0 then
    return query select true, 0, 0::numeric, 0, null::text, false, 0, 0,
                        entitlements.fn_credit_balance(p_member), 0;
    return;
  end if;

  v_base  := coalesce(entitlements.fn_base_price_cents(p_offering), 0);
  v_tier  := entitlements.fn_tier_discount_pct(p_member, o.type);
  v_after := round(v_base * (1 - v_tier/100.0))::int;

  if p_coupon is not null then
    c := entitlements.fn_validate_coupon(p_coupon, o.type);
    if c.id is not null then
      v_applied := true;
      if c.discount_type = 'percent' then
        v_coupon_cut := round(v_after * (c.percent/100.0))::int;
      else
        v_coupon_cut := least(c.amount_cents, v_after);
      end if;
    end if;
  end if;

  v_net    := greatest(v_after - v_coupon_cut, 0);
  v_credit := entitlements.fn_credit_balance(p_member);
  return query select false, v_base, v_tier, v_after,
                      case when v_applied then c.code else null end, v_applied, v_coupon_cut,
                      v_net, v_credit, greatest(v_net - v_credit, 0);
end $$;


--
-- Name: fn_redeem_coupon(text, uuid, uuid, integer); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_redeem_coupon(p_code text, p_member uuid, p_booking uuid, p_amount_cents integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare d entitlements.discounts;
begin
  select * into d from entitlements.discounts
   where kind='coupon' and lower(code)=lower(p_code) and is_active for update;
  if d.id is null then return; end if;
  insert into entitlements.coupon_redemptions(discount_id, member_id, booking_id, amount_cents)
  values (d.id, p_member, p_booking, p_amount_cents);
  update entitlements.discounts set times_redeemed = times_redeemed + 1 where id = d.id;
end $$;


--
-- Name: fn_refund_entitlement(uuid, text, integer); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_refund_entitlement(p_entitlement uuid, p_mode text, p_amount_cents integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare e entitlements.entitlements%rowtype;
begin
  select * into e from entitlements.entitlements where id = p_entitlement;
  if e.id is null then raise exception 'Entitlement not found'; end if;
  if not e.refundable then raise exception 'Granted entitlement % is not refundable', p_entitlement; end if;
  update entitlements.entitlements set status = 'refunded', quantity_remaining = 0 where id = p_entitlement;
  if p_mode = 'credit' then
    insert into entitlements.account_credit_ledger(member_id, amount_cents, reason, note)
    values (e.member_id, p_amount_cents, 'refund', 'Refund to account credit');
  end if;
end $$;


--
-- Name: fn_regrant_periodic(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_regrant_periodic() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
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


--
-- Name: fn_release_one_booking(uuid, uuid); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_release_one_booking(p_member uuid, p_offering uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
declare b entitlements.bookings%rowtype;
begin
  select * into b from entitlements.bookings
   where member_id = p_member and offering_id = p_offering and status = 'reserved'
     and coalesce(amount_charged_cents, 0) = 0 and coalesce(credit_applied_cents, 0) = 0
   order by created_at desc
   for update skip locked limit 1;
  if b.id is null then return false; end if;
  if b.consumed_entitlement_id is not null then
    update entitlements.entitlements
       set quantity_remaining = quantity_remaining + 1,
           status = case when status = 'consumed' then 'active' else status end
     where id = b.consumed_entitlement_id;
  end if;
  update entitlements.bookings set status = 'cancelled' where id = b.id;
  return true;
end $$;


--
-- Name: fn_sync_cohort_offerings(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_sync_cohort_offerings() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
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
end $$;


--
-- Name: fn_tier_discount_pct(uuid, entitlements.offering_type); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_tier_discount_pct(p_member uuid, p_type entitlements.offering_type) RETURNS numeric
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select coalesce(max(d.percent),0)
  from entitlements.discounts d
  where d.kind = 'tier'
    and d.discount_type = 'percent'
    and d.is_active
    and d.tier_code = entitlements.fn_active_tier(p_member)
    and (d.applies_to is null or d.applies_to = p_type)
    and (d.valid_from is null or d.valid_from <= now())
    and (d.valid_to   is null or d.valid_to   >  now());
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: discounts; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    tier_code text,
    code text,
    label text,
    discount_type text NOT NULL,
    percent numeric(5,2),
    amount_cents integer,
    applies_to entitlements.offering_type,
    valid_from timestamp with time zone,
    valid_to timestamp with time zone,
    max_redemptions integer,
    times_redeemed integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discounts_check CHECK (((kind = 'coupon'::text) OR (tier_code IS NOT NULL))),
    CONSTRAINT discounts_check1 CHECK (((kind = 'tier'::text) OR (code IS NOT NULL))),
    CONSTRAINT discounts_check2 CHECK (((discount_type = 'fixed'::text) OR (percent IS NOT NULL))),
    CONSTRAINT discounts_check3 CHECK (((discount_type = 'percent'::text) OR (amount_cents IS NOT NULL))),
    CONSTRAINT discounts_discount_type_check CHECK ((discount_type = ANY (ARRAY['percent'::text, 'fixed'::text]))),
    CONSTRAINT discounts_kind_check CHECK ((kind = ANY (ARRAY['tier'::text, 'coupon'::text])))
);


--
-- Name: fn_validate_coupon(text, entitlements.offering_type); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.fn_validate_coupon(p_code text, p_type entitlements.offering_type) RETURNS entitlements.discounts
    LANGUAGE sql STABLE
    SET search_path TO 'entitlements', 'public'
    AS $$
  select d.* from entitlements.discounts d
  where d.kind = 'coupon'
    and d.is_active
    and lower(d.code) = lower(p_code)
    and (d.applies_to is null or d.applies_to = p_type)
    and (d.valid_from is null or d.valid_from <= now())
    and (d.valid_to   is null or d.valid_to   >  now())
    and (d.max_redemptions is null or d.times_redeemed < d.max_redemptions)
  limit 1;
$$;


--
-- Name: project_tier(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.project_tier() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'entitlements', 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from entitlements.tiers where membership_tier_id = old.id;
    return old;
  end if;
  insert into entitlements.tiers
    (code, membership_tier_id, name, annual_price_cents, store_discount_pct, stripe_price_id, stripe_price_id_monthly, is_free)
  values (
    lower(regexp_replace(new.name, '[^A-Za-z0-9]+', '_', 'g')), new.id, new.name, new.annual_cost_cents,
    coalesce((select percent_off from public.store_tier_discounts d where d.tier_id = new.id and d.scope = 'all' limit 1), 0),
    new.stripe_price_id, new.stripe_price_id_monthly, new.is_free)
  on conflict (membership_tier_id) do update set
    code = excluded.code, name = excluded.name, annual_price_cents = excluded.annual_price_cents,
    store_discount_pct = excluded.store_discount_pct, stripe_price_id = excluded.stripe_price_id,
    stripe_price_id_monthly = excluded.stripe_price_id_monthly, is_free = excluded.is_free;
  return new;
end $$;


--
-- Name: trg_booking_guard(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.trg_booking_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'entitlements', 'public'
    AS $$
declare ent entitlements.entitlements%rowtype;
begin
  if new.consumed_entitlement_id is not null then
    select * into ent from entitlements.entitlements where id = new.consumed_entitlement_id;
    if ent.member_id <> new.member_id then
      raise exception 'Entitlement % does not belong to this member (no cross-member use)', ent.id;
    end if;
  end if;
  return new;
end $$;


--
-- Name: trg_touch_updated_at(); Type: FUNCTION; Schema: entitlements; Owner: -
--

CREATE FUNCTION entitlements.trg_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'entitlements', 'public'
    AS $$ begin new.updated_at = now(); return new; end $$;


--
-- Name: audit_members(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_members() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP::audit_action_type,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: can_read_chat_channel(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels ch
    WHERE ch.id = _channel_id AND (
      EXISTS (
        SELECT 1 FROM public.cohort_members cm
        JOIN public.members m ON m.id = cm.member_id
        WHERE cm.cohort_id = ch.cohort_id
          AND cm.status = 'active'
          AND m.clerk_user_id = _clerk_sub
      )
      OR EXISTS (
        SELECT 1 FROM public.mentoring_cohorts mc
        JOIN public.members m ON m.id = mc.mentor_member_id
        WHERE mc.id = ch.cohort_id AND m.clerk_user_id = _clerk_sub
      )
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.member_id AND m.clerk_user_id = _clerk_sub)
      OR EXISTS (SELECT 1 FROM public.members m WHERE m.id = ch.host_member_id AND m.clerk_user_id = _clerk_sub)
    )
  );
$$;


--
-- Name: can_read_space(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    -- Open spaces are readable by any authenticated member.
    EXISTS (SELECT 1 FROM community_spaces s WHERE s.id = p_space_id AND s.access_type = 'open')
    -- Active roster membership (any role) grants access.
    OR EXISTS (
      SELECT 1 FROM community_space_members sm
      JOIN members m ON m.id = sm.member_id
      WHERE sm.space_id = p_space_id AND sm.status = 'active'
        AND m.clerk_user_id = p_clerk_user_id
    )
    -- Membership-tier auto-grant (private / secret).
    OR EXISTS (
      SELECT 1 FROM community_space_tiers st
      JOIN member_memberships mm ON mm.tier_id = st.tier_id
      JOIN members m ON m.id = mm.member_id
      WHERE st.space_id = p_space_id AND m.clerk_user_id = p_clerk_user_id
        AND mm.renewal_status = 'active'
        AND (mm.expires_at IS NULL OR mm.expires_at >= now()::date)
    );
$$;


--
-- Name: decrement_post_comment_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_post_comment_count(p_post_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  UPDATE public.community_posts
  SET comment_count = greatest(comment_count - 1, 0),
      updated_at = now()
  WHERE id = p_post_id;
$$;


--
-- Name: ensure_tier_space(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_tier_space(p_tier_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  t_name text;
  s_slug text;
  s_id   uuid;
begin
  select name into t_name from public.membership_tiers where id = p_tier_id;
  if t_name is null then
    return null;
  end if;

  s_slug := public.tier_space_slug(t_name);

  -- Deliberately keyed on the canonical tier slug, NOT on "does this tier grant
  -- any Space at all". A tier can be granted to Spaces that are nothing to do
  -- with it — Educator currently grants both its own Tier Space and an event
  -- Space — so the looser check would see one of those, decide the tier was
  -- already provisioned, and leave it without the Space this rule is about.
  select id into s_id from public.community_spaces where slug = s_slug;
  if s_id is not null then
    -- Present but perhaps not linked (or the link was removed); make it so.
    insert into public.community_space_tiers (space_id, tier_id)
    values (s_id, p_tier_id)
    on conflict do nothing;
    return s_id;
  end if;

  insert into public.community_spaces
    (slug, name, description, access_type, min_tier_rank, display_order)
  values
    (s_slug, t_name || ' Tier Space',
     'Members-only space for everyone on the ' || t_name || ' tier.',
     'private', 0, 100)
  on conflict (slug) do nothing;

  select id into s_id from public.community_spaces where slug = s_slug;
  if s_id is null then
    return null;
  end if;

  insert into public.community_space_tiers (space_id, tier_id)
  values (s_id, p_tier_id)
  on conflict do nothing;

  insert into public.community_channels (space_id, slug, name, display_order)
  select s_id, 'general', 'General', 0
   where not exists (
     select 1 from public.community_channels
      where space_id = s_id and slug = 'general'
   );

  return s_id;
end;
$$;


--
-- Name: event_slug_inventory(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_slug_inventory() RETURNS TABLE(event_slug text, table_name text, row_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  r record;
begin
  -- 3a. Every column actually named event_slug.
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'event_slug'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    return query execute format(
      'select event_slug::text, %L::text, count(*)::bigint from public.%I where event_slug is not null group by 1',
      r.t, r.t
    );
  end loop;

  -- 3b. Event containers.
  return query
    select campaign_ref::text,
           'mentoring_cohorts.campaign_ref'::text,
           count(*)::bigint
    from public.mentoring_cohorts
    where container_type = 'event_participation' and campaign_ref is not null
    group by 1;

  -- 3c. Space→event links.
  return query
    select object_ref::text,
           'community_space_sources.object_ref'::text,
           count(*)::bigint
    from public.community_space_sources
    where object_type = 'event' and object_ref is not null
    group by 1;

  -- 3d. Course→event attachments.
  return query
    select object_ref::text,
           'course_object_assignments.object_ref'::text,
           count(*)::bigint
    from public.course_object_assignments
    where object_type = 'event' and object_ref is not null
    group by 1;
end;
$$;


--
-- Name: event_slug_row_counts(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_slug_row_counts(p_slug text) RETURNS TABLE(table_name text, row_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  r record;
  n bigint;
begin
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'event_slug'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('select count(*) from public.%I where event_slug = $1', r.t)
      into n using p_slug;
    if n > 0 then
      table_name := r.t;
      row_count := n;
      return next;
    end if;
  end loop;
end;
$_$;


--
-- Name: flag_manual_grade_edit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.flag_manual_grade_edit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF OLD.grade IS DISTINCT FROM NEW.grade
     AND NEW.grade_auto_promote = OLD.grade_auto_promote THEN
    NEW.grade_auto_promote = false;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: increment_post_comment_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_post_comment_count(p_post_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  UPDATE public.community_posts
  SET comment_count = comment_count + 1,
      updated_at = now()
  WHERE id = p_post_id;
$$;


--
-- Name: increment_resource_download(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_resource_download(rid uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  UPDATE public.community_resources SET download_count = download_count + 1 WHERE id = rid;
$$;


--
-- Name: participants_inherit_member_membership_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.participants_inherit_member_membership_id() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE m_id text;
BEGIN
  IF NEW.member_id IS NOT NULL THEN
    SELECT membership_id INTO m_id FROM public.members WHERE id = NEW.member_id;
    IF m_id IS NOT NULL THEN
      NEW.membership_id := m_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: promote_grades(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_grades() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE members
  SET
    grade = CASE grade
      WHEN 'grade_9'           THEN 'grade_10'::grade_type
      WHEN 'grade_10'          THEN 'grade_11'::grade_type
      WHEN 'grade_11'          THEN 'grade_12'::grade_type
      WHEN 'grade_12'          THEN 'college_freshman'::grade_type
      WHEN 'college_freshman'  THEN 'college_sophomore'::grade_type
      WHEN 'college_sophomore' THEN 'college_junior'::grade_type
      WHEN 'college_junior'    THEN 'college_senior'::grade_type
      WHEN 'college_senior'    THEN 'grad_phd'::grade_type
      ELSE grade
    END,
    age_bracket = CASE
      WHEN grade = 'grade_12' THEN 'college'::age_bracket_type
      ELSE age_bracket
    END,
    grade_auto_promote = true   -- preserve auto-promote flag through system update
  WHERE grade_auto_promote = true
    AND grade IS NOT NULL
    AND is_active = true;
END;
$$;


--
-- Name: rename_event_slug(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rename_event_slug(p_old text, p_new text) RETURNS TABLE(table_name text, rows_updated bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  r record;
  n bigint;
begin
  if coalesce(p_old, '') = '' or coalesce(p_new, '') = '' then
    raise exception 'rename_event_slug: both the old and new slug are required';
  end if;
  if p_old = p_new then
    raise exception 'rename_event_slug: old and new slug are identical (%)', p_old;
  end if;

  -- 2a. Every column actually named event_slug (migration 138 behaviour).
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'event_slug'
      and tb.table_type = 'BASE TABLE'
    order by c.table_name
  loop
    execute format('update public.%I set event_slug = $2 where event_slug = $1', r.t)
      using p_old, p_new;
    get diagnostics n = row_count;
    if n > 0 then
      table_name := r.t;
      rows_updated := n;
      return next;
    end if;
  end loop;

  -- 2b. The event container's slug. Filtered on container_type: campaign_ref is
  -- only an event slug for event_participation rows.
  update public.mentoring_cohorts
     set campaign_ref = p_new
   where campaign_ref = p_old
     and container_type = 'event_participation';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'mentoring_cohorts.campaign_ref';
    rows_updated := n;
    return next;
  end if;

  -- 2c. The Space→event link. Filtered on object_type: object_ref holds a
  -- training module id or a cohort uuid for other rows.
  update public.community_space_sources
     set object_ref = p_new
   where object_ref = p_old
     and object_type = 'event';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'community_space_sources.object_ref';
    rows_updated := n;
    return next;
  end if;

  -- 2d. Course→object attachments. Empty in prod today, same shape of trap.
  update public.course_object_assignments
     set object_ref = p_new
   where object_ref = p_old
     and object_type = 'event';
  get diagnostics n = row_count;
  if n > 0 then
    table_name := 'course_object_assignments.object_ref';
    rows_updated := n;
    return next;
  end if;
end;
$_$;


--
-- Name: set_training_progress(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_training_progress(p_member_id uuid, p_item_id uuid, p_status text) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  INSERT INTO public.training_progress (member_id, item_id, status, completed_at, updated_at)
  VALUES (
    p_member_id,
    p_item_id,
    p_status,
    CASE WHEN p_status = 'completed' THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (member_id, item_id) DO UPDATE
    SET status = EXCLUDED.status,
        completed_at = CASE WHEN EXCLUDED.status = 'completed' THEN now() ELSE NULL END,
        updated_at = now();
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: space_unread_counts(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.space_unread_counts(_member_id uuid) RETURNS TABLE(space_id uuid, unread bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.space_id, count(*)::bigint
  FROM public.community_posts p
  LEFT JOIN public.community_post_reads r
    ON r.post_id = p.id AND r.member_id = _member_id
  WHERE p.status = 'published'
    AND p.author_member_id <> _member_id
    AND (r.post_id IS NULL OR p.created_at > r.read_at)
  GROUP BY p.space_id;
$$;


--
-- Name: tg_ensure_tier_space(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_ensure_tier_space() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.ensure_tier_space(new.id);
  return new;
end;
$$;


--
-- Name: tier_space_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tier_space_slug(p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  select 'tier-' || trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
$$;


--
-- Name: account_credit_ledger; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.account_credit_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    reason entitlements.credit_reason NOT NULL,
    related_booking_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    offering_id uuid NOT NULL,
    consumed_entitlement_id uuid,
    amount_charged_cents integer DEFAULT 0 NOT NULL,
    credit_applied_cents integer DEFAULT 0 NOT NULL,
    stripe_payment_id text,
    status entitlements.booking_status DEFAULT 'reserved'::entitlements.booking_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coupon_redemptions; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.coupon_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    discount_id uuid NOT NULL,
    member_id uuid NOT NULL,
    booking_id uuid,
    amount_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: entitlements; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    kind entitlements.entitlement_kind NOT NULL,
    scope_type entitlements.scope_type NOT NULL,
    offering_id uuid,
    offering_type entitlements.offering_type,
    quantity_total integer NOT NULL,
    quantity_remaining integer NOT NULL,
    source entitlements.grant_source NOT NULL,
    source_ref text,
    refundable boolean DEFAULT false NOT NULL,
    status entitlements.entitlement_status DEFAULT 'active'::entitlements.entitlement_status NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT entitlements_check CHECK ((quantity_remaining <= quantity_total)),
    CONSTRAINT entitlements_quantity_remaining_check CHECK ((quantity_remaining >= 0)),
    CONSTRAINT entitlements_quantity_total_check CHECK ((quantity_total > 0))
);


--
-- Name: member_grant_runs; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.member_grant_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    tier_benefit_id uuid NOT NULL,
    period_start date NOT NULL,
    entitlement_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offerings; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.offerings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type entitlements.offering_type NOT NULL,
    cohort_id uuid,
    provider_member_id uuid,
    title text NOT NULL,
    segment text,
    duration_min integer,
    capacity integer,
    seats_taken integer DEFAULT 0 NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT offerings_check CHECK (((capacity IS NULL) OR (seats_taken <= capacity))),
    CONSTRAINT offerings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'full'::text, 'cancelled'::text, 'completed'::text])))
);


--
-- Name: prices; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    offering_id uuid,
    offering_type entitlements.offering_type,
    segment text,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    CONSTRAINT prices_check CHECK (((offering_id IS NOT NULL) OR (offering_type IS NOT NULL)))
);


--
-- Name: processed_events; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.processed_events (
    event_id text NOT NULL,
    type text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tier_benefits; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.tier_benefits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_code text NOT NULL,
    kind entitlements.entitlement_kind,
    quantity integer,
    period text DEFAULT 'one_off'::text NOT NULL,
    validity_days integer,
    discount_pct numeric(5,2),
    applies_to entitlements.offering_type,
    extra_stripe_price_id text,
    CONSTRAINT tier_benefits_check CHECK ((((kind IS NOT NULL) AND (quantity IS NOT NULL)) OR (discount_pct IS NOT NULL))),
    CONSTRAINT tier_benefits_period_check CHECK ((period = ANY (ARRAY['one_off'::text, 'monthly'::text, 'quarterly'::text, 'per_term'::text])))
);


--
-- Name: tiers; Type: TABLE; Schema: entitlements; Owner: -
--

CREATE TABLE entitlements.tiers (
    code text NOT NULL,
    membership_tier_id uuid,
    name text NOT NULL,
    member_group text,
    annual_price_cents integer,
    store_discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
    stripe_price_id text,
    stripe_price_id_monthly text,
    is_free boolean DEFAULT false NOT NULL
);


--
-- Name: member_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    role public.member_role_type NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    object_type text,
    object_id text,
    granted_by uuid,
    source text DEFAULT 'backfill'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_roles_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'object'::text])))
);


--
-- Name: object_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    object_type text NOT NULL,
    object_id text NOT NULL,
    role text DEFAULT 'manager'::text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT object_roles_object_type_check CHECK ((object_type = ANY (ARRAY['event'::text, 'group'::text, 'container'::text, 'space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'campaign'::text, 'resource'::text]))),
    CONSTRAINT object_roles_role_check CHECK ((role = 'manager'::text))
);


--
-- Name: access_redundancy_audit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.access_redundancy_audit WITH (security_invoker='on') AS
 SELECT a.member_id,
    a.object_type,
    a.object_id,
    (a.role)::text AS roster_role,
    (b.role)::text AS manager_role,
    'member_roles'::text AS manager_source
   FROM (public.member_roles a
     JOIN public.member_roles b ON (((b.member_id = a.member_id) AND (b.object_type = a.object_type) AND (NOT (b.object_id IS DISTINCT FROM a.object_id)))))
  WHERE ((a.scope = 'object'::text) AND (b.scope = 'object'::text) AND (a.role = ANY (ARRAY['member'::public.member_role_type, 'participant'::public.member_role_type])) AND (b.role = ANY (ARRAY['moderator'::public.member_role_type, 'mentor'::public.member_role_type, 'coach'::public.member_role_type])))
UNION ALL
 SELECT mr.member_id,
    mr.object_type,
    mr.object_id,
    (mr.role)::text AS roster_role,
    orl.role AS manager_role,
    'object_roles'::text AS manager_source
   FROM (public.member_roles mr
     JOIN public.object_roles orl ON (((orl.member_id = mr.member_id) AND (orl.object_type = mr.object_type) AND (orl.object_id = mr.object_id))))
  WHERE ((mr.scope = 'object'::text) AND (mr.role = ANY (ARRAY['member'::public.member_role_type, 'participant'::public.member_role_type])));


--
-- Name: account_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    currency text NOT NULL,
    amount_cents integer NOT NULL,
    remaining_cents integer NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    source_type text DEFAULT 'registration_refund'::text NOT NULL,
    source_participant_id uuid,
    source_registration_id uuid,
    reason text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_credits_amount_cents_check CHECK ((amount_cents > 0)),
    CONSTRAINT account_credits_remaining_cents_check CHECK ((remaining_cents >= 0)),
    CONSTRAINT account_credits_status_check CHECK ((status = ANY (ARRAY['available'::text, 'partially_redeemed'::text, 'redeemed'::text, 'expired'::text])))
);


--
-- Name: allergy_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.allergy_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    record_id uuid NOT NULL,
    action public.audit_action_type NOT NULL,
    changed_by text,
    old_data jsonb,
    new_data jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chat_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    cohort_id uuid,
    member_id uuid,
    host_member_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    space_id uuid,
    CONSTRAINT chat_channels_kind_check CHECK ((kind = ANY (ARRAY['cohort'::text, 'coaching'::text, 'space'::text])))
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    author_member_id uuid,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    flagged_at timestamp with time zone,
    flagged_by uuid
);


--
-- Name: coaching_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coaching_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    topic text NOT NULL,
    stage text,
    focus_area text,
    availability text[] DEFAULT '{}'::text[] NOT NULL,
    note text,
    status text DEFAULT 'pending'::text NOT NULL,
    coach_id uuid,
    eligibility text,
    workshop_id uuid,
    session_id uuid,
    decline_reason text,
    declined_at timestamp with time zone,
    matched_at timestamp with time zone,
    scheduled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coaching_requests_eligibility_check CHECK ((eligibility = ANY (ARRAY['included'::text, 'award'::text, 'paid'::text]))),
    CONSTRAINT coaching_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'matched'::text, 'scheduled'::text, 'declined'::text])))
);


--
-- Name: cohort_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cohort_members (
    cohort_id uuid NOT NULL,
    member_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    relationship text DEFAULT 'participant'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_at timestamp with time zone,
    accepted_at timestamp with time zone,
    CONSTRAINT cohort_members_relationship_check CHECK ((relationship = ANY (ARRAY['participant'::text, 'host'::text, 'manager'::text, 'volunteer'::text]))),
    CONSTRAINT cohort_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text])))
);


--
-- Name: cohort_training_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cohort_training_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    module_id uuid NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    due_at timestamp with time zone,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    author_member_id uuid,
    title text NOT NULL,
    body text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    display_order integer DEFAULT 0 NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    parent_comment_id uuid,
    author_member_id uuid,
    body_json jsonb,
    body_text text,
    status text DEFAULT 'published'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_comments_status_check CHECK ((status = ANY (ARRAY['published'::text, 'hidden'::text, 'deleted'::text])))
);


--
-- Name: community_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_type text NOT NULL,
    content_id uuid NOT NULL,
    flagged_by uuid,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    note text,
    viewed_in_container text,
    CONSTRAINT community_flags_content_type_check CHECK ((content_type = ANY (ARRAY['post'::text, 'comment'::text, 'resource'::text]))),
    CONSTRAINT community_flags_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: COLUMN community_flags.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_flags.note IS 'Optional reporter free-text, distinct from the reason enum (Resources Catalogue §4.3).';


--
-- Name: COLUMN community_flags.viewed_in_container; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_flags.viewed_in_container IS 'For resource flags: the container (mentoring_cohorts.id) the resource was viewed in.';


--
-- Name: community_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_member_id uuid NOT NULL,
    actor_member_id uuid,
    type text NOT NULL,
    reference_type text,
    reference_id uuid,
    body text,
    is_read boolean DEFAULT false NOT NULL,
    emailed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_notifications_type_check CHECK ((type = ANY (ARRAY['reply'::text, 'mention'::text, 'announcement'::text, 'resource'::text, 'session'::text, 'session_reminder'::text, 'recording'::text, 'action'::text, 'invite'::text])))
);


--
-- Name: community_post_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_post_reads (
    member_id uuid NOT NULL,
    post_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    author_member_id uuid,
    title text NOT NULL,
    body_json jsonb,
    body_text text,
    is_announcement boolean DEFAULT false NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channel_id uuid,
    CONSTRAINT community_posts_status_check CHECK ((status = ANY (ARRAY['published'::text, 'hidden'::text, 'deleted'::text])))
);


--
-- Name: community_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    author_member_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_reactions_target_type_check CHECK ((target_type = ANY (ARRAY['post'::text, 'comment'::text])))
);


--
-- Name: community_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid,
    title text NOT NULL,
    description text,
    storage_path text,
    file_type text,
    file_size_bytes bigint,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    event_ref text,
    material_kind text DEFAULT 'general'::text NOT NULL,
    from_chat boolean DEFAULT false NOT NULL,
    source_post_id uuid,
    source_url text,
    content_hash text,
    normalised_url text,
    download_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT community_resources_material_kind_check CHECK ((material_kind = ANY (ARRAY['general'::text, 'event'::text, 'campaign'::text, 'cte'::text])))
);


--
-- Name: COLUMN community_resources.source_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_resources.source_url IS 'Destination of a LINK resource (file_type=''link''). NULL for uploaded files.';


--
-- Name: COLUMN community_resources.content_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_resources.content_hash IS 'sha256 hex of an uploaded file''s bytes — dedup key (Resources Catalogue §5).';


--
-- Name: COLUMN community_resources.normalised_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_resources.normalised_url IS 'Canonicalised source_url (tracking params / trailing slash stripped) — link dedup key.';


--
-- Name: community_space_invites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    invited_by uuid,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    claimed_member_id uuid,
    CONSTRAINT community_space_invites_role_check CHECK ((role = ANY (ARRAY['moderator'::text, 'member'::text])))
);


--
-- Name: community_space_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    member_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    invited_by uuid,
    invited_at timestamp with time zone,
    accepted_at timestamp with time zone,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    muted boolean DEFAULT false NOT NULL,
    CONSTRAINT community_space_members_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'moderator'::text, 'member'::text]))),
    CONSTRAINT community_space_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text])))
);


--
-- Name: community_space_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_roles (
    space_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_space_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    object_type text NOT NULL,
    object_ref text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_space_sources_object_type_check CHECK ((object_type = ANY (ARRAY['event'::text, 'training'::text, 'mentoring'::text, 'coaching'::text])))
);


--
-- Name: community_space_suspensions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_suspensions (
    space_id uuid NOT NULL,
    member_id uuid NOT NULL,
    scope text NOT NULL,
    reason text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    CONSTRAINT community_space_suspensions_scope_check CHECK ((scope = ANY (ARRAY['access'::text, 'posting'::text])))
);


--
-- Name: community_space_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_tiers (
    space_id uuid NOT NULL,
    tier_id uuid NOT NULL
);


--
-- Name: community_space_training; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_space_training (
    space_id uuid NOT NULL,
    training_module_id uuid NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bracket_requirements jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: COLUMN community_space_training.bracket_requirements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_space_training.bracket_requirements IS 'Per age-bracket overrides. Keys: adult|high_school|college. Value: {"mandatory":bool,"due_at":date|null}. Absent bracket falls back to is_mandatory with no deadline.';


--
-- Name: community_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    min_tier_rank smallint DEFAULT 0 NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    access_type text DEFAULT 'open'::text NOT NULL,
    theme text DEFAULT 'space'::text NOT NULL,
    posting_policy text DEFAULT 'all'::text NOT NULL,
    allow_member_uploads boolean DEFAULT true NOT NULL,
    sanity_event_id text,
    CONSTRAINT community_spaces_access_type_check CHECK ((access_type = ANY (ARRAY['open'::text, 'private'::text, 'secret'::text]))),
    CONSTRAINT community_spaces_posting_policy_check CHECK ((posting_policy = ANY (ARRAY['all'::text, 'moderators'::text]))),
    CONSTRAINT community_spaces_theme_check CHECK ((theme = ANY (ARRAY['space'::text, 'enviro'::text, 'campaign'::text, 'college'::text])))
);


--
-- Name: COLUMN community_spaces.sanity_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.community_spaces.sanity_event_id IS 'Sanity event document _id. Survives slug renames; the handle the event-sync webhook uses to find this Space. NULL for tier/role Spaces, which have no event.';


--
-- Name: container_contents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.container_contents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    container_id uuid NOT NULL,
    content_type text NOT NULL,
    content_ref text NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    due_at timestamp with time zone,
    min_membership smallint,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    display_name text,
    CONSTRAINT container_contents_content_type_check CHECK ((content_type = ANY (ARRAY['training_module'::text, 'resource'::text, 'recording'::text, 'announcement'::text, 'product'::text])))
);


--
-- Name: COLUMN container_contents.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.container_contents.display_name IS 'Per-attachment override of the resource title (Resources Catalogue, decision 1). NULL inherits community_resources.title. Scoped to this attachment only.';


--
-- Name: content_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_id uuid NOT NULL,
    target_type text NOT NULL,
    target_ref text DEFAULT '*'::text NOT NULL,
    access_level text DEFAULT 'view'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_entitlements_access_level_check CHECK ((access_level = ANY (ARRAY['view'::text, 'download'::text, 'enroll'::text, 'host'::text]))),
    CONSTRAINT content_entitlements_target_type_check CHECK ((target_type = ANY (ARRAY['space'::text, 'resource'::text, 'training_module'::text, 'event_material'::text, 'campaign_material'::text, 'mentoring'::text, 'coaching'::text])))
);


--
-- Name: content_persistence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_persistence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_ref text NOT NULL,
    policy text DEFAULT 're_gate'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_persistence_policy_check CHECK ((policy = ANY (ARRAY['keep_open'::text, 're_gate'::text])))
);


--
-- Name: content_prerequisites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_prerequisites (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type text NOT NULL,
    target_ref text NOT NULL,
    requires_target_type text NOT NULL,
    requires_target_ref text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_prerequisites_requires_target_type_check CHECK ((requires_target_type = ANY (ARRAY['training_module'::text, 'resource'::text]))),
    CONSTRAINT content_prerequisites_target_type_check CHECK ((target_type = ANY (ARRAY['space'::text, 'resource'::text, 'training_module'::text, 'event_material'::text, 'campaign_material'::text, 'mentoring'::text, 'coaching'::text])))
);


--
-- Name: course_object_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_object_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    object_type text NOT NULL,
    object_ref text NOT NULL,
    object_label text,
    default_requirement text DEFAULT 'optional'::text NOT NULL,
    tier_requirements jsonb DEFAULT '{}'::jsonb NOT NULL,
    due_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT course_object_assignments_default_requirement_check CHECK ((default_requirement = ANY (ARRAY['mandatory'::text, 'optional'::text, 'na'::text]))),
    CONSTRAINT course_object_assignments_object_type_check CHECK ((object_type = ANY (ARRAY['competition'::text, 'campaign'::text, 'cohort'::text, 'workshop'::text, 'space'::text])))
);


--
-- Name: credit_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_redemptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    credit_id uuid NOT NULL,
    member_id uuid NOT NULL,
    amount_cents integer NOT NULL,
    stripe_checkout_session_id text,
    applied_to text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_redemptions_amount_cents_check CHECK ((amount_cents > 0))
);


--
-- Name: deletion_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_archive (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    snapshot jsonb NOT NULL,
    deleted_by uuid,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    requested_by uuid,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    review_note text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT deletion_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: docusign_envelope_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.docusign_envelope_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    envelope_row uuid NOT NULL,
    recipient_id text NOT NULL,
    role_name text,
    name text NOT NULL,
    email text NOT NULL,
    status text NOT NULL,
    routing_order integer,
    delivered_at timestamp with time zone,
    signed_at timestamp with time zone,
    declined_at timestamp with time zone,
    last_synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT docusign_envelope_recipients_status_check CHECK ((status = ANY (ARRAY['created'::text, 'sent'::text, 'delivered'::text, 'completed'::text, 'declined'::text, 'autoresponded'::text, 'signed'::text, 'faxpending'::text])))
);


--
-- Name: TABLE docusign_envelope_recipients; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.docusign_envelope_recipients IS 'One row per DocuSign recipient, synced from the recipients API by the Connect webhook. Source of truth for WHO is outstanding on a partially-signed envelope.';


--
-- Name: docusign_envelopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.docusign_envelopes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid,
    member_id uuid,
    event_slug text NOT NULL,
    event_title text NOT NULL,
    envelope_id text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    signer_name text NOT NULL,
    signer_email text NOT NULL,
    minor_name text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    declined_at timestamp with time zone,
    reminder_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    envelope_type text DEFAULT 'minor'::text NOT NULL,
    reused_from uuid,
    signers_total integer DEFAULT 1 NOT NULL,
    signers_completed integer DEFAULT 0 NOT NULL,
    reminder_count integer DEFAULT 0 NOT NULL,
    last_manual_resend_at timestamp with time zone,
    CONSTRAINT docusign_envelopes_envelope_type_check CHECK ((envelope_type = ANY (ARRAY['minor'::text, 'adult'::text, 'mentor'::text, 'volunteer'::text]))),
    CONSTRAINT docusign_envelopes_status_check CHECK ((status = ANY (ARRAY['created'::text, 'sent'::text, 'delivered'::text, 'completed'::text, 'declined'::text, 'voided'::text])))
);


--
-- Name: COLUMN docusign_envelopes.minor_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.minor_name IS 'Subject name. For minor consent this is the minor; for adult/mentor it is the signer themselves.';


--
-- Name: COLUMN docusign_envelopes.envelope_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.envelope_type IS 'Agreement type: minor (parental consent), adult, mentor, or volunteer agreement.';


--
-- Name: COLUMN docusign_envelopes.reused_from; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.reused_from IS 'When set, this participant was covered by the referenced previously signed envelope rather than a newly issued one. envelope_id is synthetic (on-file:<uuid>) on such rows. Cascades on delete: removing the source paperwork removes its coverage records.';


--
-- Name: COLUMN docusign_envelopes.signers_total; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.signers_total IS 'Number of signers the envelope was issued with. Coverage rows (reused_from set) are 1.';


--
-- Name: COLUMN docusign_envelopes.signers_completed; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.signers_completed IS 'Signers who have completed, maintained by the DocuSign Connect webhook (recipient-completed events).';


--
-- Name: COLUMN docusign_envelopes.reminder_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.reminder_count IS 'Automated chases sent so far. Capped in the reminder cron; not incremented by admin resends.';


--
-- Name: COLUMN docusign_envelopes.last_manual_resend_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.docusign_envelopes.last_manual_resend_at IS 'Last admin-triggered resend. Deliberately separate from reminder_sent_at so a manual resend does not stop the cron.';


--
-- Name: email_campaign_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaign_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    member_id uuid NOT NULL,
    due_at timestamp with time zone NOT NULL,
    dedup_key text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    CONSTRAINT email_campaign_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: email_campaign_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaign_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    member_id uuid NOT NULL,
    dedup_key text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_campaign_sends_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'suppressed'::text])))
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    template_id uuid NOT NULL,
    trigger_type text NOT NULL,
    scheduled_at timestamp with time zone,
    event_key text,
    audience jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    delay_days integer DEFAULT 0 NOT NULL,
    sequence_key text,
    CONSTRAINT email_campaigns_delay_days_nonneg CHECK ((delay_days >= 0)),
    CONSTRAINT email_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'paused'::text, 'archived'::text]))),
    CONSTRAINT email_campaigns_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['scheduled'::text, 'event'::text])))
);


--
-- Name: COLUMN email_campaigns.delay_days; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_campaigns.delay_days IS 'Days after the trigger event before sending. 0 = send inline (default).';


--
-- Name: COLUMN email_campaigns.sequence_key; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.email_campaigns.sequence_key IS 'Optional label grouping the campaigns of one drip sequence in the admin UI.';


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_json jsonb,
    is_archived boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ethnicity_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ethnicity_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL
);


--
-- Name: event_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_slug text NOT NULL,
    number integer NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_companies_number_check CHECK (((number >= 1) AND (number <= 10)))
);


--
-- Name: event_manager_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_manager_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clerk_user_id text NOT NULL,
    event_slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event_participations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_participations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    event_year integer,
    event_location text,
    team_name text,
    award text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'approved'::text NOT NULL,
    event_slug text,
    event_title text,
    role text,
    CONSTRAINT event_participations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text])))
);


--
-- Name: COLUMN event_participations.event_slug; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_participations.event_slug IS 'Set on rows auto-created from a registration; NULL for member-logged historical activity.';


--
-- Name: COLUMN event_participations.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_participations.role IS 'How the member took part: NULL = attendee/competitor (default), ''volunteer'' = assigned event volunteer.';


--
-- Name: event_refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_refunds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_id uuid,
    registration_id uuid,
    member_id uuid,
    event_slug text,
    paid_cents integer,
    refund_type text NOT NULL,
    refund_pct integer,
    refund_cents integer,
    credit_validity_days integer,
    days_out integer,
    stripe_refund_id text,
    account_credit_id uuid,
    decided_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_refunds_refund_type_check CHECK ((refund_type = ANY (ARRAY['cash'::text, 'credit'::text, 'manual_required'::text, 'none'::text])))
);


--
-- Name: event_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_settings (
    event_slug text NOT NULL,
    company_count integer,
    check_in_token text,
    check_in_open boolean DEFAULT false NOT NULL,
    badge_artwork_path text,
    certificate_artwork_path text,
    certificate_format text DEFAULT 'us_letter'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_settings_certificate_format_check CHECK ((certificate_format = ANY (ARRAY['us_letter'::text, 'a4'::text]))),
    CONSTRAINT event_settings_company_count_check CHECK (((company_count >= 1) AND (company_count <= 10)))
);


--
-- Name: event_store_offerings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_store_offerings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_slug text NOT NULL,
    variant_id uuid NOT NULL,
    treatment text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_store_offerings_treatment_check CHECK ((treatment = ANY (ARRAY['included'::text, 'addon'::text])))
);


--
-- Name: group_join_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_join_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    token text NOT NULL,
    registration_id uuid NOT NULL,
    event_slug text NOT NULL,
    event_title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL
);


--
-- Name: host_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_availability (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_member_id uuid NOT NULL,
    weekday smallint NOT NULL,
    start_minute integer NOT NULL,
    end_minute integer NOT NULL,
    session_type text DEFAULT 'both'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT host_availability_end_minute_check CHECK (((end_minute >= 0) AND (end_minute <= 1440))),
    CONSTRAINT host_availability_session_type_check CHECK ((session_type = ANY (ARRAY['coaching'::text, 'mentoring'::text, 'both'::text]))),
    CONSTRAINT host_availability_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1440))),
    CONSTRAINT host_availability_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)))
);


--
-- Name: lead_capture_failures; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lead_capture_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email text NOT NULL,
    source text NOT NULL,
    reason text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by text,
    notes text
);


--
-- Name: TABLE lead_capture_failures; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.lead_capture_failures IS 'Dead-letter queue for lead captures that failed to reach HubSpot. Recovery net only — HubSpot remains the source of truth.';


--
-- Name: member_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    actor_type text DEFAULT 'system'::text NOT NULL,
    actor_member_id uuid,
    actor_label text,
    category text NOT NULL,
    action text NOT NULL,
    summary text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_activity_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['admin'::text, 'member'::text, 'system'::text, 'stripe'::text, 'docusign'::text]))),
    CONSTRAINT member_activity_log_category_check CHECK ((category = ANY (ARRAY['membership'::text, 'profile'::text, 'account'::text, 'event'::text, 'billing'::text, 'docusign'::text, 'community'::text, 'school'::text, 'compliance'::text])))
);


--
-- Name: member_addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_addresses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    label text,
    line1 text NOT NULL,
    line2 text,
    city text NOT NULL,
    state text NOT NULL,
    postcode text NOT NULL,
    country text DEFAULT 'US'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_allergies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_allergies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    notes text,
    allergy_option_id uuid
);


--
-- Name: member_background_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_background_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    provider text DEFAULT 'checkr'::text NOT NULL,
    request_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    result text,
    ordered_by uuid,
    ordered_label text,
    ordered_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    report_pdf_url text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    provider_candidate_ref text,
    provider_invitation_ref text,
    provider_report_ref text,
    invitation_url text,
    assessment text,
    includes_canceled boolean DEFAULT false NOT NULL,
    CONSTRAINT member_background_checks_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'in_progress'::text, 'passed'::text, 'referred'::text, 'cancelled'::text, 'expired'::text, 'error'::text])))
);


--
-- Name: COLUMN member_background_checks.assessment; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_background_checks.assessment IS 'Checkr Assess tag (eligible / review / escalated) — takes precedence over result.';


--
-- Name: COLUMN member_background_checks.includes_canceled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.member_background_checks.includes_canceled IS 'True when a completed report contained one or more canceled screenings (Complete Now).';


--
-- Name: member_directory_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_directory_prefs (
    member_id uuid NOT NULL,
    is_visible boolean DEFAULT false NOT NULL,
    show_school boolean DEFAULT true NOT NULL,
    show_region boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_ethnicities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_ethnicities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    ethnicity_option_id uuid
);


--
-- Name: member_group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_group_members (
    group_id uuid NOT NULL,
    member_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    name text NOT NULL,
    event_slug text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    tier_id uuid NOT NULL,
    started_at date NOT NULL,
    expires_at date,
    renewal_status public.membership_renewal_status DEFAULT 'active'::public.membership_renewal_status NOT NULL,
    is_complimentary boolean DEFAULT false NOT NULL,
    stripe_subscription_id text,
    stripe_customer_id text,
    stripe_payment_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    billing_interval text,
    source text DEFAULT 'manual'::text NOT NULL,
    granted_by_rule uuid,
    CONSTRAINT member_memberships_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['monthly'::text, 'annual'::text])))
);


--
-- Name: member_notification_prefs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_notification_prefs (
    member_id uuid NOT NULL,
    inapp_enabled boolean DEFAULT true NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    sms_enabled boolean DEFAULT false NOT NULL,
    sms_number text,
    sms_consent_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    school_id uuid NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    started_at date,
    ended_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: member_teacher_licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_teacher_licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    license_number text NOT NULL,
    licensing_state text NOT NULL,
    expiry_date date NOT NULL,
    verified_at timestamp with time zone,
    verified_by uuid,
    verified_label text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_path text
);


--
-- Name: participants_membership_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.participants_membership_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_code text,
    clerk_user_id text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    nickname text,
    date_of_birth date NOT NULL,
    gender public.gender_type NOT NULL,
    phone text,
    email text NOT NULL,
    discord_handle text,
    age_bracket public.age_bracket_type NOT NULL,
    event_role public.event_role_type NOT NULL,
    grade public.grade_type,
    grade_auto_promote boolean DEFAULT true NOT NULL,
    tshirt_size public.tshirt_size_type,
    ec_first_name text,
    ec_last_name text,
    ec_email text,
    ec_phone text,
    health_conditions text,
    profile_photo_url text,
    is_active boolean DEFAULT true NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_customer_id text,
    ec_relationship text,
    graduation_year integer,
    marketing_consent boolean DEFAULT true NOT NULL,
    marketing_unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    marketing_unsubscribed_at timestamp with time zone,
    membership_id text DEFAULT lpad((nextval('public.participants_membership_id_seq'::regclass))::text, 7, '0'::text) NOT NULL
);


--
-- Name: membership_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    grouping_title text,
    age_bracket public.age_bracket_type,
    annual_cost_cents integer DEFAULT 0 NOT NULL,
    stripe_price_id text,
    is_free boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stripe_price_id_monthly text,
    description text,
    marketing_copy text,
    badge_color text,
    default_grant_months integer,
    eligible_roles text[],
    includes_free_mentoring boolean DEFAULT false NOT NULL,
    mentoring_credits_grant integer DEFAULT 0 NOT NULL,
    workshop_credits_grant integer DEFAULT 0 NOT NULL,
    academy_discount_percent integer DEFAULT 0 NOT NULL,
    monthly_cost_cents integer
);


--
-- Name: mentoring_cohorts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mentoring_cohorts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    mentor_member_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    container_type text DEFAULT 'mentoring'::text NOT NULL,
    lifecycle text DEFAULT 'active'::text NOT NULL,
    archived_at timestamp with time zone,
    parent_container_id uuid,
    campaign_ref text,
    registration_id uuid,
    theme text DEFAULT 'space'::text NOT NULL,
    timezone text DEFAULT 'America/Chicago'::text NOT NULL,
    planned_sessions integer DEFAULT 6 NOT NULL,
    start_date date,
    is_open boolean DEFAULT false NOT NULL,
    blurb text,
    free_for_tier_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    one_off_price_cents integer,
    one_off_stripe_price_id text,
    credit_cost integer DEFAULT 1 NOT NULL,
    sanity_event_id text,
    CONSTRAINT mentoring_cohorts_container_type_check CHECK ((container_type = ANY (ARRAY['mentoring'::text, 'coaching'::text, 'space'::text, 'event_participation'::text, 'campaign_participation'::text, 'training'::text, 'workshop'::text]))),
    CONSTRAINT mentoring_cohorts_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['active'::text, 'archived'::text])))
);


--
-- Name: COLUMN mentoring_cohorts.sanity_event_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.mentoring_cohorts.sanity_event_id IS 'Sanity event document _id for event_participation containers. NULL otherwise.';


--
-- Name: merch_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merch_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_type text NOT NULL,
    event_slug text NOT NULL,
    owner_member_id uuid,
    ship_to jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    pod_order_id text,
    tracking_url text,
    committed_by uuid,
    committed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT merch_batches_batch_type_check CHECK ((batch_type = ANY (ARRAY['event_venue'::text, 'educator_campaign'::text]))),
    CONSTRAINT merch_batches_status_check CHECK ((status = ANY (ARRAY['open'::text, 'committed'::text, 'ordered'::text, 'shipped'::text, 'received'::text])))
);


--
-- Name: object_type_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_type_relations (
    from_type text NOT NULL,
    to_type text NOT NULL,
    allowed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT object_type_relations_from_type_check CHECK ((from_type = ANY (ARRAY['space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'event'::text, 'campaign'::text, 'resource'::text]))),
    CONSTRAINT object_type_relations_to_type_check CHECK ((to_type = ANY (ARRAY['space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'event'::text, 'campaign'::text, 'resource'::text])))
);


--
-- Name: object_type_singleton_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.object_type_singleton_roles (
    object_type text NOT NULL,
    role public.member_role_type NOT NULL,
    CONSTRAINT object_type_singleton_roles_object_type_check CHECK ((object_type = ANY (ARRAY['space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'event'::text, 'campaign'::text, 'resource'::text])))
);


--
-- Name: participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.participants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    registration_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    nickname text,
    email text NOT NULL,
    phone text NOT NULL,
    date_of_birth date NOT NULL,
    grade text,
    gender text NOT NULL,
    ethnicity text[] DEFAULT '{}'::text[] NOT NULL,
    t_shirt_size text NOT NULL,
    school_name text NOT NULL,
    age_bracket text NOT NULL,
    event_role text NOT NULL,
    dietary_requirements text[] DEFAULT '{}'::text[] NOT NULL,
    health_conditions text,
    emergency_contact_first_name text,
    emergency_contact_last_name text,
    emergency_contact_email text,
    emergency_contact_phone text,
    company_name text,
    award text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    membership_id text DEFAULT lpad((nextval('public.participants_membership_id_seq'::regclass))::text, 7, '0'::text) NOT NULL,
    member_id uuid,
    individual_payment_status text,
    join_completed_at timestamp with time zone,
    emergency_contact_relationship text,
    company_id uuid,
    checked_in_at timestamp with time zone,
    check_in_method text,
    stripe_payment_intent_id text,
    merch_collected boolean DEFAULT false NOT NULL,
    merch_collected_at timestamp with time zone,
    individual_payment_link_sent_at timestamp with time zone,
    CONSTRAINT participants_check_in_method_check CHECK ((check_in_method = ANY (ARRAY['qr'::text, 'manual'::text, 'virtual'::text]))),
    CONSTRAINT participants_individual_payment_status_check CHECK (((individual_payment_status = ANY (ARRAY['pending'::text, 'paid'::text, 'waived'::text])) OR (individual_payment_status IS NULL)))
);


--
-- Name: platform_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_pricing (
    id boolean DEFAULT true NOT NULL,
    cohort_price_cents integer DEFAULT 0 NOT NULL,
    workshop_price_cents integer DEFAULT 0 NOT NULL,
    cohort_credit_price_cents integer DEFAULT 4000 NOT NULL,
    workshop_credit_price_cents integer DEFAULT 4000 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_pricing_id_check CHECK (id)
);


--
-- Name: refund_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    event_slug text,
    tiers jsonb NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refund_policies_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'event'::text])))
);


--
-- Name: registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registrations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    event_slug text NOT NULL,
    event_title text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    withdrawn_at timestamp with time zone,
    teacher_first_name text,
    teacher_last_name text,
    teacher_email text,
    school_name text,
    school_address_street text,
    school_address_city text,
    school_address_state text,
    school_address_zip text,
    invoice_requested boolean DEFAULT false NOT NULL,
    registrant_role text DEFAULT 'teacher'::text NOT NULL,
    teacher_poc_first_name text,
    teacher_poc_last_name text,
    teacher_poc_email text,
    member_pays_individually boolean DEFAULT false NOT NULL,
    details_method text DEFAULT 'add_now'::text NOT NULL,
    teacher_member_id uuid,
    spreadsheet_id text,
    school_dpa_agreed_at timestamp with time zone,
    stripe_payment_intent_id text,
    adult_count integer,
    student_count integer,
    amount_due_cents integer,
    group_name text,
    contact_role text,
    proposal_storage_path text,
    proposal_file_name text,
    proposal_notes text,
    proposal_submitted_at timestamp with time zone,
    invoice_paid_at timestamp with time zone,
    invoice_paid_by uuid,
    CONSTRAINT registrations_details_method_check CHECK ((details_method = ANY (ARRAY['add_now'::text, 'spreadsheet'::text, 'email_link'::text]))),
    CONSTRAINT registrations_registrant_role_check CHECK ((registrant_role = ANY (ARRAY['teacher'::text, 'student_manager'::text]))),
    CONSTRAINT registrations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'withdrawn'::text]))),
    CONSTRAINT registrations_type_check CHECK ((type = ANY (ARRAY['individual'::text, 'group'::text, 'campaign'::text])))
);


--
-- Name: schools; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schools (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    school_code text,
    name text NOT NULL,
    street text,
    city text,
    state text,
    zip_code text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    address_line1 text,
    address_line2 text,
    postcode text
);


--
-- Name: sent_reminders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sent_reminders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    ref_id text NOT NULL,
    member_id uuid,
    bucket text DEFAULT ''::text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_action_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_action_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    host_member_id uuid,
    session_type text NOT NULL,
    title text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_action_templates_session_type_check CHECK ((session_type = ANY (ARRAY['coaching'::text, 'mentoring'::text])))
);


--
-- Name: session_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    member_id uuid NOT NULL,
    title text NOT NULL,
    is_done boolean DEFAULT false NOT NULL,
    completed_at timestamp with time zone,
    created_by uuid,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    training_module_id uuid,
    cohort_id uuid,
    batch_id uuid,
    remind_before_hours integer
);


--
-- Name: session_hosts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_hosts (
    member_id uuid NOT NULL,
    can_coach boolean DEFAULT false NOT NULL,
    can_mentor boolean DEFAULT false NOT NULL,
    bio text,
    approved_by uuid,
    approved_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_participants (
    session_id uuid NOT NULL,
    member_id uuid NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_type text NOT NULL,
    host_member_id uuid,
    cohort_id uuid,
    member_id uuid,
    title text,
    scheduled_start timestamp with time zone NOT NULL,
    scheduled_end timestamp with time zone,
    status text DEFAULT 'scheduled'::text NOT NULL,
    provider text,
    provider_room text,
    join_url text,
    recording_path text,
    recording_status text DEFAULT 'none'::text NOT NULL,
    host_notes text,
    is_paid_extra boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sessions_recording_status_check CHECK ((recording_status = ANY (ARRAY['none'::text, 'pending'::text, 'available'::text]))),
    CONSTRAINT sessions_session_type_check CHECK ((session_type = ANY (ARRAY['coaching'::text, 'mentoring'::text]))),
    CONSTRAINT sessions_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'scheduled'::text, 'declined'::text, 'cancelled'::text, 'completed'::text])))
);


--
-- Name: sheet_watch_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheet_watch_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    registration_id uuid NOT NULL,
    channel_id text NOT NULL,
    resource_id text,
    expiration timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: staff_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_roles (
    member_id uuid NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: store_event_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_event_discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text DEFAULT 'global'::text NOT NULL,
    event_slug text,
    product_id uuid,
    category text,
    percent_off integer NOT NULL,
    CONSTRAINT store_event_discounts_percent_off_check CHECK (((percent_off >= 0) AND (percent_off <= 100))),
    CONSTRAINT store_event_discounts_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'event'::text])))
);


--
-- Name: store_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    variant_id uuid,
    sku text,
    name text,
    qty integer DEFAULT 1 NOT NULL,
    unit_amount_cents integer DEFAULT 0 NOT NULL,
    line_source text DEFAULT 'storefront'::text NOT NULL,
    fulfillment_mode text DEFAULT 'direct'::text NOT NULL,
    fulfillment_status text DEFAULT 'pending'::text NOT NULL,
    batch_id uuid,
    participant_member_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_order_items_fulfillment_mode_check CHECK ((fulfillment_mode = ANY (ARRAY['direct'::text, 'batch'::text]))),
    CONSTRAINT store_order_items_fulfillment_status_check CHECK ((fulfillment_status = ANY (ARRAY['pending'::text, 'awaiting_batch'::text, 'ordered'::text, 'shipped'::text, 'collected'::text, 'reshipped'::text, 'cancelled'::text]))),
    CONSTRAINT store_order_items_line_source_check CHECK ((line_source = ANY (ARRAY['storefront'::text, 'event_included'::text, 'event_addon'::text, 'reship'::text])))
);


--
-- Name: store_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid,
    email text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    channel text DEFAULT 'storefront'::text NOT NULL,
    event_slug text,
    stripe_checkout_session_id text,
    stripe_payment_intent_id text,
    subtotal_cents integer DEFAULT 0 NOT NULL,
    discount_cents integer DEFAULT 0 NOT NULL,
    shipping_cents integer DEFAULT 0 NOT NULL,
    tax_cents integer DEFAULT 0 NOT NULL,
    total_cents integer DEFAULT 0 NOT NULL,
    ship_to jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pod_order_id text,
    tracking_url text,
    registration_id uuid,
    CONSTRAINT store_orders_channel_check CHECK ((channel = ANY (ARRAY['storefront'::text, 'event_registration'::text, 'educator_bulk'::text, 'reship'::text]))),
    CONSTRAINT store_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'fulfilling'::text, 'shipped'::text, 'delivered'::text, 'refunded'::text, 'cancelled'::text])))
);


--
-- Name: store_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    product_type text DEFAULT 'merch'::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    pod_provider text DEFAULT 'printful'::text NOT NULL,
    pod_sync_product_id text,
    images jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_event_shirt boolean DEFAULT false NOT NULL,
    featured boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_products_pod_provider_check CHECK ((pod_provider = ANY (ARRAY['printful'::text, 'self'::text]))),
    CONSTRAINT store_products_product_type_check CHECK ((product_type = ANY (ARRAY['apparel'::text, 'merch'::text, 'sticker'::text, 'digital'::text]))),
    CONSTRAINT store_products_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])))
);


--
-- Name: store_returns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    member_id uuid,
    reason text,
    status text DEFAULT 'requested'::text NOT NULL,
    stripe_refund_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT store_returns_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'approved'::text, 'refunded'::text, 'denied'::text])))
);


--
-- Name: store_tier_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_tier_discounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tier_id uuid NOT NULL,
    scope text DEFAULT 'all'::text NOT NULL,
    product_id uuid,
    category text,
    percent_off integer NOT NULL,
    CONSTRAINT store_tier_discounts_percent_off_check CHECK (((percent_off >= 0) AND (percent_off <= 100))),
    CONSTRAINT store_tier_discounts_scope_check CHECK ((scope = ANY (ARRAY['all'::text, 'product'::text, 'category'::text])))
);


--
-- Name: store_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.store_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    label text,
    options jsonb DEFAULT '{}'::jsonb NOT NULL,
    market_price_cents integer DEFAULT 0 NOT NULL,
    pod_sync_variant_id text,
    inventory_qty integer,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: stripe_webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_webhook_events (
    id text NOT NULL,
    type text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tier_grant_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tier_grant_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    trigger_type text NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb NOT NULL,
    grant_tier_id uuid,
    duration_kind text DEFAULT 'months'::text NOT NULL,
    duration_months integer,
    replaces_free boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    grant_target text DEFAULT 'self'::text NOT NULL,
    grant_kind text DEFAULT 'tier'::text NOT NULL,
    grant_credit_type text,
    grant_quantity integer,
    object_type text,
    object_anchor_ref text,
    tier_min text,
    grant_object_type text,
    grant_object_ref text,
    grant_role text,
    is_dynamic boolean DEFAULT false NOT NULL,
    duration_until date,
    CONSTRAINT tier_grant_rules_duration_kind_check CHECK ((duration_kind = ANY (ARRAY['months'::text, 'until_grad_july1'::text, 'lifetime'::text, 'match_source'::text, 'until_date'::text]))),
    CONSTRAINT tier_grant_rules_grant_credit_type_check CHECK ((grant_credit_type = ANY (ARRAY['mentoring'::text, 'workshop'::text]))),
    CONSTRAINT tier_grant_rules_grant_kind_check CHECK ((grant_kind = ANY (ARRAY['tier'::text, 'credits'::text, 'attach_object'::text, 'roster_add'::text]))),
    CONSTRAINT tier_grant_rules_grant_object_type_check CHECK ((grant_object_type = ANY (ARRAY['space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'event'::text, 'campaign'::text, 'resource'::text]))),
    CONSTRAINT tier_grant_rules_grant_shape_check CHECK ((((grant_kind = 'tier'::text) AND (grant_tier_id IS NOT NULL)) OR ((grant_kind = 'credits'::text) AND (grant_credit_type IS NOT NULL) AND (grant_quantity IS NOT NULL) AND (grant_quantity > 0)) OR ((grant_kind = ANY (ARRAY['attach_object'::text, 'roster_add'::text])) AND (grant_object_type IS NOT NULL) AND ((grant_object_ref IS NOT NULL) OR is_dynamic)))),
    CONSTRAINT tier_grant_rules_grant_target_check CHECK ((grant_target = ANY (ARRAY['self'::text, 'registered_students'::text]))),
    CONSTRAINT tier_grant_rules_object_anchor_check CHECK (((trigger_type <> 'object_created'::text) OR (object_type IS NOT NULL))),
    CONSTRAINT tier_grant_rules_object_type_check CHECK ((object_type = ANY (ARRAY['space'::text, 'course'::text, 'workshop'::text, 'cohort'::text, 'event'::text, 'campaign'::text, 'resource'::text]))),
    CONSTRAINT tier_grant_rules_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['signup'::text, 'event_attendance'::text, 'event_award'::text, 'mentor_at_event'::text, 'subscribe_website'::text, 'graduation'::text, 'manual'::text, 'campaign_enrollment'::text, 'competition_registration'::text, 'tier_purchased'::text, 'object_created'::text, 'volunteer_registration'::text])))
);


--
-- Name: training_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    event_ref text NOT NULL,
    event_role text NOT NULL,
    is_mandatory boolean DEFAULT false NOT NULL,
    due_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_certificates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    module_id uuid NOT NULL,
    cert_number text NOT NULL,
    issuer text DEFAULT 'Stellr Education'::text NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    module_id uuid NOT NULL,
    enrolled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_item_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_item_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    storage_path text,
    external_url text,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT training_item_resources_kind_check CHECK ((kind = ANY (ARRAY['file'::text, 'link'::text])))
);


--
-- Name: training_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    title text NOT NULL,
    content_kind text NOT NULL,
    storage_path text,
    external_url text,
    estimated_minutes integer,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    body text,
    section_id uuid,
    status text DEFAULT 'published'::text NOT NULL,
    recording_path text,
    recording_status text DEFAULT 'none'::text NOT NULL,
    interactive_key text,
    CONSTRAINT training_items_content_kind_check CHECK ((content_kind = ANY (ARRAY['video'::text, 'document'::text, 'google_doc'::text, 'link'::text, 'live'::text, 'interactive'::text]))),
    CONSTRAINT training_items_recording_status_check CHECK ((recording_status = ANY (ARRAY['none'::text, 'pending'::text, 'available'::text]))),
    CONSTRAINT training_items_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text])))
);


--
-- Name: training_modules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    material_kind text DEFAULT 'general'::text NOT NULL,
    event_ref text,
    min_tier_rank smallint DEFAULT 0 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    course_type text DEFAULT 'self_paced'::text NOT NULL,
    start_date timestamp with time zone,
    theme text,
    remind_inapp boolean DEFAULT true NOT NULL,
    remind_email boolean DEFAULT true NOT NULL,
    remind_sms boolean DEFAULT false NOT NULL,
    remind_2wk boolean DEFAULT false NOT NULL,
    remind_1wk boolean DEFAULT true NOT NULL,
    remind_2d boolean DEFAULT false NOT NULL,
    remind_1d boolean DEFAULT true NOT NULL,
    escalate_supervisor boolean DEFAULT true NOT NULL,
    cert_template_path text,
    CONSTRAINT training_modules_course_type_check CHECK ((course_type = ANY (ARRAY['self_paced'::text, 'structured'::text, 'scheduled'::text]))),
    CONSTRAINT training_modules_material_kind_check CHECK ((material_kind = ANY (ARRAY['general'::text, 'event'::text, 'campaign'::text, 'cte'::text, 'curriculum'::text]))),
    CONSTRAINT training_modules_theme_check CHECK (((theme IS NULL) OR (theme = ANY (ARRAY['space'::text, 'environmental'::text, 'campaign'::text]))))
);


--
-- Name: training_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    item_id uuid NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT training_progress_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text])))
);


--
-- Name: training_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    title text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    drip_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: video_watermark_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_watermark_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket text NOT NULL,
    storage_path text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT video_watermark_jobs_kind_check CHECK ((kind = ANY (ARRAY['recording'::text, 'training'::text]))),
    CONSTRAINT video_watermark_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'done'::text, 'failed'::text])))
);


--
-- Name: volunteer_event_interest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.volunteer_event_interest (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    event_slug text NOT NULL,
    event_title text NOT NULL,
    status text DEFAULT 'interested'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volunteer_event_interest_status_check CHECK ((status = ANY (ARRAY['interested'::text, 'withdrawn'::text])))
);


--
-- Name: account_credit_ledger account_credit_ledger_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.account_credit_ledger
    ADD CONSTRAINT account_credit_ledger_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: coupon_redemptions coupon_redemptions_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_pkey PRIMARY KEY (id);


--
-- Name: discounts discounts_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.discounts
    ADD CONSTRAINT discounts_pkey PRIMARY KEY (id);


--
-- Name: entitlements entitlements_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.entitlements
    ADD CONSTRAINT entitlements_pkey PRIMARY KEY (id);


--
-- Name: member_grant_runs member_grant_runs_membership_id_tier_benefit_id_period_star_key; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_membership_id_tier_benefit_id_period_star_key UNIQUE (membership_id, tier_benefit_id, period_start);


--
-- Name: member_grant_runs member_grant_runs_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_pkey PRIMARY KEY (id);


--
-- Name: offerings offerings_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.offerings
    ADD CONSTRAINT offerings_pkey PRIMARY KEY (id);


--
-- Name: prices prices_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.prices
    ADD CONSTRAINT prices_pkey PRIMARY KEY (id);


--
-- Name: processed_events processed_events_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.processed_events
    ADD CONSTRAINT processed_events_pkey PRIMARY KEY (event_id);


--
-- Name: tier_benefits tier_benefits_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.tier_benefits
    ADD CONSTRAINT tier_benefits_pkey PRIMARY KEY (id);


--
-- Name: tiers tiers_membership_tier_id_key; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.tiers
    ADD CONSTRAINT tiers_membership_tier_id_key UNIQUE (membership_tier_id);


--
-- Name: tiers tiers_pkey; Type: CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.tiers
    ADD CONSTRAINT tiers_pkey PRIMARY KEY (code);


--
-- Name: account_credits account_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_credits
    ADD CONSTRAINT account_credits_pkey PRIMARY KEY (id);


--
-- Name: allergy_options allergy_options_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergy_options
    ADD CONSTRAINT allergy_options_name_key UNIQUE (name);


--
-- Name: allergy_options allergy_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.allergy_options
    ADD CONSTRAINT allergy_options_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: chat_channels chat_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: coaching_requests coaching_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_requests
    ADD CONSTRAINT coaching_requests_pkey PRIMARY KEY (id);


--
-- Name: cohort_members cohort_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_members
    ADD CONSTRAINT cohort_members_pkey PRIMARY KEY (cohort_id, member_id);


--
-- Name: cohort_training_links cohort_training_links_cohort_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_training_links
    ADD CONSTRAINT cohort_training_links_cohort_id_module_id_key UNIQUE (cohort_id, module_id);


--
-- Name: cohort_training_links cohort_training_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_training_links
    ADD CONSTRAINT cohort_training_links_pkey PRIMARY KEY (id);


--
-- Name: community_announcements community_announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_announcements
    ADD CONSTRAINT community_announcements_pkey PRIMARY KEY (id);


--
-- Name: community_channels community_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_channels
    ADD CONSTRAINT community_channels_pkey PRIMARY KEY (id);


--
-- Name: community_channels community_channels_space_id_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_channels
    ADD CONSTRAINT community_channels_space_id_slug_key UNIQUE (space_id, slug);


--
-- Name: community_comments community_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_pkey PRIMARY KEY (id);


--
-- Name: community_flags community_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_flags
    ADD CONSTRAINT community_flags_pkey PRIMARY KEY (id);


--
-- Name: community_notifications community_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_notifications
    ADD CONSTRAINT community_notifications_pkey PRIMARY KEY (id);


--
-- Name: community_post_reads community_post_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_reads
    ADD CONSTRAINT community_post_reads_pkey PRIMARY KEY (member_id, post_id);


--
-- Name: community_posts community_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);


--
-- Name: community_reactions community_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reactions
    ADD CONSTRAINT community_reactions_pkey PRIMARY KEY (id);


--
-- Name: community_reactions community_reactions_target_type_target_id_author_member_id__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reactions
    ADD CONSTRAINT community_reactions_target_type_target_id_author_member_id__key UNIQUE (target_type, target_id, author_member_id, emoji);


--
-- Name: community_resources community_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_resources
    ADD CONSTRAINT community_resources_pkey PRIMARY KEY (id);


--
-- Name: community_space_invites community_space_invites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_invites
    ADD CONSTRAINT community_space_invites_pkey PRIMARY KEY (id);


--
-- Name: community_space_invites community_space_invites_space_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_invites
    ADD CONSTRAINT community_space_invites_space_id_email_key UNIQUE (space_id, email);


--
-- Name: community_space_members community_space_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_members
    ADD CONSTRAINT community_space_members_pkey PRIMARY KEY (id);


--
-- Name: community_space_members community_space_members_space_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_members
    ADD CONSTRAINT community_space_members_space_id_member_id_key UNIQUE (space_id, member_id);


--
-- Name: community_space_roles community_space_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_roles
    ADD CONSTRAINT community_space_roles_pkey PRIMARY KEY (space_id, role);


--
-- Name: community_space_sources community_space_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_sources
    ADD CONSTRAINT community_space_sources_pkey PRIMARY KEY (id);


--
-- Name: community_space_sources community_space_sources_space_id_object_type_object_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_sources
    ADD CONSTRAINT community_space_sources_space_id_object_type_object_ref_key UNIQUE (space_id, object_type, object_ref);


--
-- Name: community_space_suspensions community_space_suspensions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_suspensions
    ADD CONSTRAINT community_space_suspensions_pkey PRIMARY KEY (space_id, member_id, scope);


--
-- Name: community_space_tiers community_space_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_tiers
    ADD CONSTRAINT community_space_tiers_pkey PRIMARY KEY (space_id, tier_id);


--
-- Name: community_space_training community_space_training_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_training
    ADD CONSTRAINT community_space_training_pkey PRIMARY KEY (space_id, training_module_id);


--
-- Name: community_spaces community_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_spaces
    ADD CONSTRAINT community_spaces_pkey PRIMARY KEY (id);


--
-- Name: community_spaces community_spaces_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_spaces
    ADD CONSTRAINT community_spaces_slug_key UNIQUE (slug);


--
-- Name: container_contents container_contents_container_id_content_type_content_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.container_contents
    ADD CONSTRAINT container_contents_container_id_content_type_content_ref_key UNIQUE (container_id, content_type, content_ref);


--
-- Name: container_contents container_contents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.container_contents
    ADD CONSTRAINT container_contents_pkey PRIMARY KEY (id);


--
-- Name: content_entitlements content_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_entitlements
    ADD CONSTRAINT content_entitlements_pkey PRIMARY KEY (id);


--
-- Name: content_entitlements content_entitlements_tier_id_target_type_target_ref_access__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_entitlements
    ADD CONSTRAINT content_entitlements_tier_id_target_type_target_ref_access__key UNIQUE (tier_id, target_type, target_ref, access_level);


--
-- Name: content_persistence content_persistence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_persistence
    ADD CONSTRAINT content_persistence_pkey PRIMARY KEY (id);


--
-- Name: content_persistence content_persistence_target_type_target_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_persistence
    ADD CONSTRAINT content_persistence_target_type_target_ref_key UNIQUE (target_type, target_ref);


--
-- Name: content_prerequisites content_prerequisites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_prerequisites
    ADD CONSTRAINT content_prerequisites_pkey PRIMARY KEY (id);


--
-- Name: content_prerequisites content_prerequisites_target_type_target_ref_requires_targe_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_prerequisites
    ADD CONSTRAINT content_prerequisites_target_type_target_ref_requires_targe_key UNIQUE (target_type, target_ref, requires_target_type, requires_target_ref);


--
-- Name: course_object_assignments course_object_assignments_module_id_object_type_object_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_object_assignments
    ADD CONSTRAINT course_object_assignments_module_id_object_type_object_ref_key UNIQUE (module_id, object_type, object_ref);


--
-- Name: course_object_assignments course_object_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_object_assignments
    ADD CONSTRAINT course_object_assignments_pkey PRIMARY KEY (id);


--
-- Name: credit_redemptions credit_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_pkey PRIMARY KEY (id);


--
-- Name: deletion_archive deletion_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_archive
    ADD CONSTRAINT deletion_archive_pkey PRIMARY KEY (id);


--
-- Name: deletion_requests deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: docusign_envelope_recipients docusign_envelope_recipients_envelope_row_recipient_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelope_recipients
    ADD CONSTRAINT docusign_envelope_recipients_envelope_row_recipient_id_key UNIQUE (envelope_row, recipient_id);


--
-- Name: docusign_envelope_recipients docusign_envelope_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelope_recipients
    ADD CONSTRAINT docusign_envelope_recipients_pkey PRIMARY KEY (id);


--
-- Name: docusign_envelopes docusign_envelopes_envelope_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_envelope_id_key UNIQUE (envelope_id);


--
-- Name: docusign_envelopes docusign_envelopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_pkey PRIMARY KEY (id);


--
-- Name: email_campaign_queue email_campaign_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_queue
    ADD CONSTRAINT email_campaign_queue_pkey PRIMARY KEY (id);


--
-- Name: email_campaign_sends email_campaign_sends_campaign_id_member_id_dedup_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sends
    ADD CONSTRAINT email_campaign_sends_campaign_id_member_id_dedup_key_key UNIQUE (campaign_id, member_id, dedup_key);


--
-- Name: email_campaign_sends email_campaign_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sends
    ADD CONSTRAINT email_campaign_sends_pkey PRIMARY KEY (id);


--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_key_key UNIQUE (key);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: ethnicity_options ethnicity_options_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ethnicity_options
    ADD CONSTRAINT ethnicity_options_name_key UNIQUE (name);


--
-- Name: ethnicity_options ethnicity_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ethnicity_options
    ADD CONSTRAINT ethnicity_options_pkey PRIMARY KEY (id);


--
-- Name: event_companies event_companies_event_slug_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_companies
    ADD CONSTRAINT event_companies_event_slug_number_key UNIQUE (event_slug, number);


--
-- Name: event_companies event_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_companies
    ADD CONSTRAINT event_companies_pkey PRIMARY KEY (id);


--
-- Name: event_manager_assignments event_manager_assignments_clerk_user_id_event_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_manager_assignments
    ADD CONSTRAINT event_manager_assignments_clerk_user_id_event_slug_key UNIQUE (clerk_user_id, event_slug);


--
-- Name: event_manager_assignments event_manager_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_manager_assignments
    ADD CONSTRAINT event_manager_assignments_pkey PRIMARY KEY (id);


--
-- Name: event_participations event_participations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participations
    ADD CONSTRAINT event_participations_pkey PRIMARY KEY (id);


--
-- Name: event_refunds event_refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_refunds
    ADD CONSTRAINT event_refunds_pkey PRIMARY KEY (id);


--
-- Name: event_settings event_settings_check_in_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_settings
    ADD CONSTRAINT event_settings_check_in_token_key UNIQUE (check_in_token);


--
-- Name: event_settings event_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_settings
    ADD CONSTRAINT event_settings_pkey PRIMARY KEY (event_slug);


--
-- Name: event_store_offerings event_store_offerings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_store_offerings
    ADD CONSTRAINT event_store_offerings_pkey PRIMARY KEY (id);


--
-- Name: group_join_tokens group_join_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_join_tokens
    ADD CONSTRAINT group_join_tokens_pkey PRIMARY KEY (id);


--
-- Name: group_join_tokens group_join_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_join_tokens
    ADD CONSTRAINT group_join_tokens_token_key UNIQUE (token);


--
-- Name: host_availability host_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_availability
    ADD CONSTRAINT host_availability_pkey PRIMARY KEY (id);


--
-- Name: lead_capture_failures lead_capture_failures_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lead_capture_failures
    ADD CONSTRAINT lead_capture_failures_pkey PRIMARY KEY (id);


--
-- Name: member_activity_log member_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_activity_log
    ADD CONSTRAINT member_activity_log_pkey PRIMARY KEY (id);


--
-- Name: member_addresses member_addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_addresses
    ADD CONSTRAINT member_addresses_pkey PRIMARY KEY (id);


--
-- Name: member_allergies member_allergies_member_id_allergy_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_allergies
    ADD CONSTRAINT member_allergies_member_id_allergy_option_id_key UNIQUE (member_id, allergy_option_id);


--
-- Name: member_allergies member_allergies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_allergies
    ADD CONSTRAINT member_allergies_pkey PRIMARY KEY (id);


--
-- Name: member_background_checks member_background_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_background_checks
    ADD CONSTRAINT member_background_checks_pkey PRIMARY KEY (id);


--
-- Name: member_directory_prefs member_directory_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_directory_prefs
    ADD CONSTRAINT member_directory_prefs_pkey PRIMARY KEY (member_id);


--
-- Name: member_ethnicities member_ethnicities_member_id_ethnicity_option_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_ethnicities
    ADD CONSTRAINT member_ethnicities_member_id_ethnicity_option_id_key UNIQUE (member_id, ethnicity_option_id);


--
-- Name: member_ethnicities member_ethnicities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_ethnicities
    ADD CONSTRAINT member_ethnicities_pkey PRIMARY KEY (id);


--
-- Name: member_group_members member_group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_group_members
    ADD CONSTRAINT member_group_members_pkey PRIMARY KEY (group_id, member_id);


--
-- Name: member_groups member_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_groups
    ADD CONSTRAINT member_groups_pkey PRIMARY KEY (id);


--
-- Name: member_memberships member_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_pkey PRIMARY KEY (id);


--
-- Name: member_notification_prefs member_notification_prefs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_notification_prefs
    ADD CONSTRAINT member_notification_prefs_pkey PRIMARY KEY (member_id);


--
-- Name: member_roles member_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_pkey PRIMARY KEY (id);


--
-- Name: member_roles member_roles_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_uniq UNIQUE NULLS NOT DISTINCT (member_id, role, object_type, object_id);


--
-- Name: member_schools member_schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_schools
    ADD CONSTRAINT member_schools_pkey PRIMARY KEY (id);


--
-- Name: member_teacher_licenses member_teacher_licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teacher_licenses
    ADD CONSTRAINT member_teacher_licenses_pkey PRIMARY KEY (id);


--
-- Name: members members_clerk_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_clerk_user_id_key UNIQUE (clerk_user_id);


--
-- Name: members members_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_email_key UNIQUE (email);


--
-- Name: members members_member_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_member_code_key UNIQUE (member_code);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: membership_tiers membership_tiers_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_name_key UNIQUE (name);


--
-- Name: membership_tiers membership_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_tiers
    ADD CONSTRAINT membership_tiers_pkey PRIMARY KEY (id);


--
-- Name: mentoring_cohorts mentoring_cohorts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentoring_cohorts
    ADD CONSTRAINT mentoring_cohorts_pkey PRIMARY KEY (id);


--
-- Name: merch_batches merch_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_batches
    ADD CONSTRAINT merch_batches_pkey PRIMARY KEY (id);


--
-- Name: object_roles object_roles_member_id_object_type_object_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_roles
    ADD CONSTRAINT object_roles_member_id_object_type_object_id_role_key UNIQUE (member_id, object_type, object_id, role);


--
-- Name: object_roles object_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_roles
    ADD CONSTRAINT object_roles_pkey PRIMARY KEY (id);


--
-- Name: object_type_relations object_type_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_type_relations
    ADD CONSTRAINT object_type_relations_pkey PRIMARY KEY (from_type, to_type);


--
-- Name: object_type_singleton_roles object_type_singleton_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_type_singleton_roles
    ADD CONSTRAINT object_type_singleton_roles_pkey PRIMARY KEY (object_type);


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_pkey PRIMARY KEY (id);


--
-- Name: platform_pricing platform_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_pricing
    ADD CONSTRAINT platform_pricing_pkey PRIMARY KEY (id);


--
-- Name: refund_policies refund_policies_event_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_policies
    ADD CONSTRAINT refund_policies_event_slug_key UNIQUE (event_slug);


--
-- Name: refund_policies refund_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_policies
    ADD CONSTRAINT refund_policies_pkey PRIMARY KEY (id);


--
-- Name: registrations registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_pkey PRIMARY KEY (id);


--
-- Name: schools schools_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_name_key UNIQUE (name);


--
-- Name: schools schools_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_pkey PRIMARY KEY (id);


--
-- Name: schools schools_school_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schools
    ADD CONSTRAINT schools_school_code_key UNIQUE (school_code);


--
-- Name: sent_reminders sent_reminders_kind_ref_id_member_id_bucket_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sent_reminders
    ADD CONSTRAINT sent_reminders_kind_ref_id_member_id_bucket_key UNIQUE (kind, ref_id, member_id, bucket);


--
-- Name: sent_reminders sent_reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sent_reminders
    ADD CONSTRAINT sent_reminders_pkey PRIMARY KEY (id);


--
-- Name: session_action_templates session_action_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_action_templates
    ADD CONSTRAINT session_action_templates_pkey PRIMARY KEY (id);


--
-- Name: session_actions session_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_pkey PRIMARY KEY (id);


--
-- Name: session_hosts session_hosts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_hosts
    ADD CONSTRAINT session_hosts_pkey PRIMARY KEY (member_id);


--
-- Name: session_participants session_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_pkey PRIMARY KEY (session_id, member_id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sheet_watch_channels sheet_watch_channels_channel_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_watch_channels
    ADD CONSTRAINT sheet_watch_channels_channel_id_key UNIQUE (channel_id);


--
-- Name: sheet_watch_channels sheet_watch_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_watch_channels
    ADD CONSTRAINT sheet_watch_channels_pkey PRIMARY KEY (id);


--
-- Name: staff_roles staff_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_roles
    ADD CONSTRAINT staff_roles_pkey PRIMARY KEY (member_id);


--
-- Name: store_event_discounts store_event_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_event_discounts
    ADD CONSTRAINT store_event_discounts_pkey PRIMARY KEY (id);


--
-- Name: store_order_items store_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_order_items
    ADD CONSTRAINT store_order_items_pkey PRIMARY KEY (id);


--
-- Name: store_orders store_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_orders
    ADD CONSTRAINT store_orders_pkey PRIMARY KEY (id);


--
-- Name: store_products store_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_products
    ADD CONSTRAINT store_products_pkey PRIMARY KEY (id);


--
-- Name: store_products store_products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_products
    ADD CONSTRAINT store_products_slug_key UNIQUE (slug);


--
-- Name: store_returns store_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_returns
    ADD CONSTRAINT store_returns_pkey PRIMARY KEY (id);


--
-- Name: store_tier_discounts store_tier_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_tier_discounts
    ADD CONSTRAINT store_tier_discounts_pkey PRIMARY KEY (id);


--
-- Name: store_variants store_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variants
    ADD CONSTRAINT store_variants_pkey PRIMARY KEY (id);


--
-- Name: store_variants store_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variants
    ADD CONSTRAINT store_variants_sku_key UNIQUE (sku);


--
-- Name: stripe_webhook_events stripe_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_webhook_events
    ADD CONSTRAINT stripe_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: tier_grant_rules tier_grant_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tier_grant_rules
    ADD CONSTRAINT tier_grant_rules_pkey PRIMARY KEY (id);


--
-- Name: training_assignments training_assignments_module_id_event_ref_event_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assignments
    ADD CONSTRAINT training_assignments_module_id_event_ref_event_role_key UNIQUE (module_id, event_ref, event_role);


--
-- Name: training_assignments training_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assignments
    ADD CONSTRAINT training_assignments_pkey PRIMARY KEY (id);


--
-- Name: training_certificates training_certificates_member_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_member_id_module_id_key UNIQUE (member_id, module_id);


--
-- Name: training_certificates training_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_pkey PRIMARY KEY (id);


--
-- Name: training_enrollments training_enrollments_member_id_module_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments
    ADD CONSTRAINT training_enrollments_member_id_module_id_key UNIQUE (member_id, module_id);


--
-- Name: training_enrollments training_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments
    ADD CONSTRAINT training_enrollments_pkey PRIMARY KEY (id);


--
-- Name: training_item_resources training_item_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_item_resources
    ADD CONSTRAINT training_item_resources_pkey PRIMARY KEY (id);


--
-- Name: training_items training_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_items
    ADD CONSTRAINT training_items_pkey PRIMARY KEY (id);


--
-- Name: training_modules training_modules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_modules
    ADD CONSTRAINT training_modules_pkey PRIMARY KEY (id);


--
-- Name: training_progress training_progress_member_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_progress
    ADD CONSTRAINT training_progress_member_id_item_id_key UNIQUE (member_id, item_id);


--
-- Name: training_progress training_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_progress
    ADD CONSTRAINT training_progress_pkey PRIMARY KEY (id);


--
-- Name: training_sections training_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_sections
    ADD CONSTRAINT training_sections_pkey PRIMARY KEY (id);


--
-- Name: video_watermark_jobs video_watermark_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watermark_jobs
    ADD CONSTRAINT video_watermark_jobs_pkey PRIMARY KEY (id);


--
-- Name: video_watermark_jobs video_watermark_jobs_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_watermark_jobs
    ADD CONSTRAINT video_watermark_jobs_storage_path_key UNIQUE (storage_path);


--
-- Name: volunteer_event_interest volunteer_event_interest_member_id_event_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_event_interest
    ADD CONSTRAINT volunteer_event_interest_member_id_event_slug_key UNIQUE (member_id, event_slug);


--
-- Name: volunteer_event_interest volunteer_event_interest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_event_interest
    ADD CONSTRAINT volunteer_event_interest_pkey PRIMARY KEY (id);


--
-- Name: account_credit_ledger_member_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX account_credit_ledger_member_id_idx ON entitlements.account_credit_ledger USING btree (member_id);


--
-- Name: bookings_member_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX bookings_member_id_idx ON entitlements.bookings USING btree (member_id);


--
-- Name: bookings_offering_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX bookings_offering_id_idx ON entitlements.bookings USING btree (offering_id) WHERE (status = 'reserved'::entitlements.booking_status);


--
-- Name: coupon_redemptions_discount_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX coupon_redemptions_discount_id_idx ON entitlements.coupon_redemptions USING btree (discount_id);


--
-- Name: coupon_redemptions_member_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX coupon_redemptions_member_id_idx ON entitlements.coupon_redemptions USING btree (member_id);


--
-- Name: entitlements_member_id_kind_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX entitlements_member_id_kind_idx ON entitlements.entitlements USING btree (member_id, kind) WHERE (status = 'active'::entitlements.entitlement_status);


--
-- Name: entitlements_offering_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX entitlements_offering_id_idx ON entitlements.entitlements USING btree (offering_id);


--
-- Name: idx_discounts_tier; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX idx_discounts_tier ON entitlements.discounts USING btree (tier_code) WHERE (kind = 'tier'::text);


--
-- Name: prices_offering_id_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX prices_offering_id_idx ON entitlements.prices USING btree (offering_id);


--
-- Name: prices_offering_type_segment_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX prices_offering_type_segment_idx ON entitlements.prices USING btree (offering_type, segment);


--
-- Name: tier_benefits_tier_code_idx; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE INDEX tier_benefits_tier_code_idx ON entitlements.tier_benefits USING btree (tier_code);


--
-- Name: uq_discounts_coupon_code; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE UNIQUE INDEX uq_discounts_coupon_code ON entitlements.discounts USING btree (lower(code)) WHERE (kind = 'coupon'::text);


--
-- Name: uq_offerings_cohort; Type: INDEX; Schema: entitlements; Owner: -
--

CREATE UNIQUE INDEX uq_offerings_cohort ON entitlements.offerings USING btree (cohort_id) WHERE (cohort_id IS NOT NULL);


--
-- Name: account_credits_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_credits_member_idx ON public.account_credits USING btree (member_id, status, expires_at);


--
-- Name: chat_channels_coaching_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channels_coaching_uniq ON public.chat_channels USING btree (member_id, host_member_id) WHERE (kind = 'coaching'::text);


--
-- Name: chat_channels_cohort_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channels_cohort_uniq ON public.chat_channels USING btree (cohort_id) WHERE (kind = 'cohort'::text);


--
-- Name: chat_channels_space_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX chat_channels_space_uniq ON public.chat_channels USING btree (space_id) WHERE (kind = 'space'::text);


--
-- Name: chat_messages_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_channel_idx ON public.chat_messages USING btree (channel_id, created_at);


--
-- Name: chat_messages_flagged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_messages_flagged_idx ON public.chat_messages USING btree (channel_id) WHERE ((flagged_at IS NOT NULL) AND (deleted_at IS NULL));


--
-- Name: cohort_training_links_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cohort_training_links_cohort_idx ON public.cohort_training_links USING btree (cohort_id);


--
-- Name: community_announcements_space_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_announcements_space_idx ON public.community_announcements USING btree (space_id, created_at DESC);


--
-- Name: community_channels_space_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_channels_space_idx ON public.community_channels USING btree (space_id, display_order);


--
-- Name: community_comments_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_comments_parent_idx ON public.community_comments USING btree (parent_comment_id);


--
-- Name: community_comments_post_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_comments_post_id_idx ON public.community_comments USING btree (post_id, created_at);


--
-- Name: community_flags_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_flags_status_idx ON public.community_flags USING btree (status, created_at DESC);


--
-- Name: community_notifications_recipient_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_notifications_recipient_idx ON public.community_notifications USING btree (recipient_member_id, is_read, created_at DESC);


--
-- Name: community_posts_announcement_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_announcement_idx ON public.community_posts USING btree (is_announcement) WHERE (is_announcement = true);


--
-- Name: community_posts_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_author_idx ON public.community_posts USING btree (author_member_id);


--
-- Name: community_posts_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_channel_idx ON public.community_posts USING btree (channel_id, created_at DESC);


--
-- Name: community_posts_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_search_idx ON public.community_posts USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(body_text, ''::text))));


--
-- Name: community_posts_space_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_posts_space_id_idx ON public.community_posts USING btree (space_id, created_at DESC);


--
-- Name: community_reactions_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_reactions_target_idx ON public.community_reactions USING btree (target_type, target_id);


--
-- Name: community_resources_content_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_resources_content_hash_idx ON public.community_resources USING btree (content_hash) WHERE (content_hash IS NOT NULL);


--
-- Name: community_resources_event_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_resources_event_ref_idx ON public.community_resources USING btree (event_ref) WHERE (event_ref IS NOT NULL);


--
-- Name: community_resources_normalised_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_resources_normalised_url_idx ON public.community_resources USING btree (normalised_url) WHERE (normalised_url IS NOT NULL);


--
-- Name: community_resources_search_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_resources_search_idx ON public.community_resources USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(description, ''::text))));


--
-- Name: community_resources_space_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_resources_space_id_idx ON public.community_resources USING btree (space_id);


--
-- Name: community_space_invites_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_invites_email_idx ON public.community_space_invites USING btree (email) WHERE (claimed_at IS NULL);


--
-- Name: community_space_members_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_members_member_idx ON public.community_space_members USING btree (member_id, status);


--
-- Name: community_space_members_space_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_members_space_idx ON public.community_space_members USING btree (space_id, role);


--
-- Name: community_space_sources_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_sources_object_idx ON public.community_space_sources USING btree (object_type, object_ref);


--
-- Name: community_space_suspensions_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_suspensions_member_idx ON public.community_space_suspensions USING btree (member_id, scope);


--
-- Name: community_space_suspensions_space_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_space_suspensions_space_idx ON public.community_space_suspensions USING btree (space_id, scope);


--
-- Name: community_spaces_display_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_spaces_display_order_idx ON public.community_spaces USING btree (display_order);


--
-- Name: community_spaces_sanity_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX community_spaces_sanity_event_id_key ON public.community_spaces USING btree (sanity_event_id) WHERE (sanity_event_id IS NOT NULL);


--
-- Name: container_contents_container_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX container_contents_container_idx ON public.container_contents USING btree (container_id);


--
-- Name: content_entitlements_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_entitlements_target_idx ON public.content_entitlements USING btree (target_type, target_ref);


--
-- Name: content_entitlements_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_entitlements_tier_idx ON public.content_entitlements USING btree (tier_id);


--
-- Name: content_prerequisites_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX content_prerequisites_target_idx ON public.content_prerequisites USING btree (target_type, target_ref);


--
-- Name: course_object_assignments_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_object_assignments_module_idx ON public.course_object_assignments USING btree (module_id);


--
-- Name: course_object_assignments_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX course_object_assignments_object_idx ON public.course_object_assignments USING btree (object_type, object_ref);


--
-- Name: credit_redemptions_credit_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX credit_redemptions_credit_idx ON public.credit_redemptions USING btree (credit_id);


--
-- Name: deletion_archive_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deletion_archive_entity_idx ON public.deletion_archive USING btree (entity_type, entity_id);


--
-- Name: deletion_requests_requester_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deletion_requests_requester_idx ON public.deletion_requests USING btree (requested_by);


--
-- Name: deletion_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deletion_requests_status_idx ON public.deletion_requests USING btree (status, created_at);


--
-- Name: docusign_envelope_recipients_envelope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelope_recipients_envelope_idx ON public.docusign_envelope_recipients USING btree (envelope_row);


--
-- Name: docusign_envelope_recipients_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelope_recipients_status_idx ON public.docusign_envelope_recipients USING btree (status) WHERE (status <> 'completed'::text);


--
-- Name: docusign_envelopes_member_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_member_id_idx ON public.docusign_envelopes USING btree (member_id);


--
-- Name: docusign_envelopes_member_valid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_member_valid_idx ON public.docusign_envelopes USING btree (member_id, envelope_type, completed_at DESC) WHERE (status = 'completed'::text);


--
-- Name: docusign_envelopes_participant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_participant_id_idx ON public.docusign_envelopes USING btree (participant_id);


--
-- Name: docusign_envelopes_reused_from_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_reused_from_idx ON public.docusign_envelopes USING btree (reused_from);


--
-- Name: docusign_envelopes_sent_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_sent_at_idx ON public.docusign_envelopes USING btree (sent_at);


--
-- Name: docusign_envelopes_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_status_idx ON public.docusign_envelopes USING btree (status);


--
-- Name: docusign_envelopes_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX docusign_envelopes_type_idx ON public.docusign_envelopes USING btree (envelope_type);


--
-- Name: email_campaign_queue_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_campaign_queue_due_idx ON public.email_campaign_queue USING btree (due_at) WHERE (status = 'pending'::text);


--
-- Name: email_campaign_queue_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_campaign_queue_unique_idx ON public.email_campaign_queue USING btree (campaign_id, member_id, dedup_key);


--
-- Name: email_campaign_sends_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_campaign_sends_campaign_idx ON public.email_campaign_sends USING btree (campaign_id);


--
-- Name: email_campaigns_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_campaigns_due_idx ON public.email_campaigns USING btree (status, scheduled_at) WHERE (trigger_type = 'scheduled'::text);


--
-- Name: email_campaigns_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_campaigns_event_idx ON public.email_campaigns USING btree (event_key, status) WHERE (trigger_type = 'event'::text);


--
-- Name: event_companies_event_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_companies_event_slug_idx ON public.event_companies USING btree (event_slug);


--
-- Name: event_manager_assignments_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_manager_assignments_event_idx ON public.event_manager_assignments USING btree (event_slug);


--
-- Name: event_manager_assignments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_manager_assignments_user_idx ON public.event_manager_assignments USING btree (clerk_user_id);


--
-- Name: event_participations_event_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_participations_event_slug_idx ON public.event_participations USING btree (event_slug);


--
-- Name: event_participations_member_event_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_participations_member_event_uniq ON public.event_participations USING btree (member_id, event_slug) WHERE (event_slug IS NOT NULL);


--
-- Name: event_refunds_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_refunds_event_idx ON public.event_refunds USING btree (event_slug);


--
-- Name: event_refunds_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_refunds_participant_idx ON public.event_refunds USING btree (participant_id);


--
-- Name: event_store_offerings_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_store_offerings_event_idx ON public.event_store_offerings USING btree (event_slug);


--
-- Name: group_join_tokens_registration_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_join_tokens_registration_idx ON public.group_join_tokens USING btree (registration_id);


--
-- Name: group_join_tokens_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX group_join_tokens_token_idx ON public.group_join_tokens USING btree (token);


--
-- Name: host_availability_host_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX host_availability_host_idx ON public.host_availability USING btree (host_member_id, weekday);


--
-- Name: idx_audit_changed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_changed_at ON public.audit_log USING btree (changed_at DESC);


--
-- Name: idx_audit_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_record ON public.audit_log USING btree (table_name, record_id);


--
-- Name: idx_coaching_requests_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_requests_member ON public.coaching_requests USING btree (member_id);


--
-- Name: idx_coaching_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coaching_requests_status ON public.coaching_requests USING btree (status);


--
-- Name: idx_event_part_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_part_member ON public.event_participations USING btree (member_id);


--
-- Name: idx_member_memberships_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_memberships_member ON public.member_memberships USING btree (member_id, renewal_status);


--
-- Name: idx_member_schools_current; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_schools_current ON public.member_schools USING btree (member_id, is_current);


--
-- Name: idx_members_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_active ON public.members USING btree (is_active) WHERE (is_active = true);


--
-- Name: idx_members_age_bracket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_age_bracket ON public.members USING btree (age_bracket);


--
-- Name: idx_members_clerk_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_clerk_id ON public.members USING btree (clerk_user_id);


--
-- Name: idx_members_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_email ON public.members USING btree (email);


--
-- Name: idx_session_actions_training; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_actions_training ON public.session_actions USING btree (training_module_id) WHERE (training_module_id IS NOT NULL);


--
-- Name: idx_vwj_actionable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_vwj_actionable ON public.video_watermark_jobs USING btree (created_at) WHERE (status = ANY (ARRAY['pending'::text, 'processing'::text]));


--
-- Name: lead_capture_failures_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_capture_failures_email_idx ON public.lead_capture_failures USING btree (lower(email));


--
-- Name: lead_capture_failures_unresolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lead_capture_failures_unresolved_idx ON public.lead_capture_failures USING btree (created_at) WHERE (resolved_at IS NULL);


--
-- Name: member_activity_log_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_activity_log_category_idx ON public.member_activity_log USING btree (category);


--
-- Name: member_activity_log_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_activity_log_member_idx ON public.member_activity_log USING btree (member_id, created_at DESC);


--
-- Name: member_addresses_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_addresses_member_idx ON public.member_addresses USING btree (member_id);


--
-- Name: member_background_checks_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_background_checks_candidate_idx ON public.member_background_checks USING btree (provider_candidate_ref);


--
-- Name: member_background_checks_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_background_checks_member_idx ON public.member_background_checks USING btree (member_id, ordered_at DESC);


--
-- Name: member_background_checks_report_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_background_checks_report_idx ON public.member_background_checks USING btree (provider_report_ref);


--
-- Name: member_background_checks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_background_checks_status_idx ON public.member_background_checks USING btree (status);


--
-- Name: member_group_members_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_group_members_member_idx ON public.member_group_members USING btree (member_id);


--
-- Name: member_groups_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_groups_owner_idx ON public.member_groups USING btree (owner_id);


--
-- Name: member_memberships_rule_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_memberships_rule_idx ON public.member_memberships USING btree (granted_by_rule);


--
-- Name: member_memberships_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_memberships_source_idx ON public.member_memberships USING btree (source);


--
-- Name: member_roles_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_roles_member_idx ON public.member_roles USING btree (member_id);


--
-- Name: member_roles_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_roles_object_idx ON public.member_roles USING btree (object_type, object_id);


--
-- Name: member_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_roles_role_idx ON public.member_roles USING btree (role);


--
-- Name: member_roles_singleton_cohort_mentor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_roles_singleton_cohort_mentor_idx ON public.member_roles USING btree (object_type, object_id) WHERE ((scope = 'object'::text) AND (object_type = 'cohort'::text) AND (role = 'mentor'::public.member_role_type));


--
-- Name: member_roles_singleton_workshop_coach_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_roles_singleton_workshop_coach_idx ON public.member_roles USING btree (object_type, object_id) WHERE ((scope = 'object'::text) AND (object_type = 'workshop'::text) AND (role = 'coach'::public.member_role_type));


--
-- Name: member_schools_member_school_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_schools_member_school_uniq ON public.member_schools USING btree (member_id, school_id);


--
-- Name: member_teacher_licenses_member_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX member_teacher_licenses_member_uidx ON public.member_teacher_licenses USING btree (member_id);


--
-- Name: members_email_lower_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_email_lower_idx ON public.members USING btree (lower(email));


--
-- Name: members_membership_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_membership_id_idx ON public.members USING btree (membership_id);


--
-- Name: members_unsub_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX members_unsub_token_idx ON public.members USING btree (marketing_unsubscribe_token);


--
-- Name: mentoring_cohorts_campaign_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mentoring_cohorts_campaign_ref_idx ON public.mentoring_cohorts USING btree (campaign_ref);


--
-- Name: mentoring_cohorts_event_container_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mentoring_cohorts_event_container_uniq ON public.mentoring_cohorts USING btree (campaign_ref) WHERE ((container_type = 'event_participation'::text) AND (parent_container_id IS NULL));


--
-- Name: mentoring_cohorts_group_container_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mentoring_cohorts_group_container_uniq ON public.mentoring_cohorts USING btree (registration_id) WHERE (registration_id IS NOT NULL);


--
-- Name: mentoring_cohorts_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mentoring_cohorts_open_idx ON public.mentoring_cohorts USING btree (is_open) WHERE (container_type = 'mentoring'::text);


--
-- Name: mentoring_cohorts_open_workshop_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mentoring_cohorts_open_workshop_idx ON public.mentoring_cohorts USING btree (is_open) WHERE (container_type = 'workshop'::text);


--
-- Name: mentoring_cohorts_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mentoring_cohorts_parent_idx ON public.mentoring_cohorts USING btree (parent_container_id);


--
-- Name: mentoring_cohorts_sanity_event_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mentoring_cohorts_sanity_event_id_idx ON public.mentoring_cohorts USING btree (sanity_event_id) WHERE (sanity_event_id IS NOT NULL);


--
-- Name: mentoring_cohorts_space_container_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mentoring_cohorts_space_container_uniq ON public.mentoring_cohorts USING btree (campaign_ref) WHERE (container_type = 'space'::text);


--
-- Name: mentoring_cohorts_training_container_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mentoring_cohorts_training_container_uniq ON public.mentoring_cohorts USING btree (campaign_ref) WHERE (container_type = 'training'::text);


--
-- Name: merch_batches_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merch_batches_event_idx ON public.merch_batches USING btree (event_slug);


--
-- Name: merch_batches_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX merch_batches_status_idx ON public.merch_batches USING btree (status);


--
-- Name: object_roles_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX object_roles_member_idx ON public.object_roles USING btree (member_id);


--
-- Name: object_roles_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX object_roles_object_idx ON public.object_roles USING btree (object_type, object_id);


--
-- Name: participants_company_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_company_id_idx ON public.participants USING btree (company_id);


--
-- Name: participants_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_email_idx ON public.participants USING btree (email);


--
-- Name: participants_event_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX participants_event_email_unique ON public.participants USING btree (registration_id, email);


--
-- Name: participants_member_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_member_id_idx ON public.participants USING btree (member_id);


--
-- Name: participants_membership_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_membership_id_idx ON public.participants USING btree (membership_id);


--
-- Name: participants_registration_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX participants_registration_id_idx ON public.participants USING btree (registration_id);


--
-- Name: refund_policies_global_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX refund_policies_global_uniq ON public.refund_policies USING btree (scope) WHERE (scope = 'global'::text);


--
-- Name: registrations_campaign_member_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX registrations_campaign_member_unique ON public.registrations USING btree (event_slug, teacher_member_id) WHERE ((type = 'campaign'::text) AND (teacher_member_id IS NOT NULL));


--
-- Name: registrations_event_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_event_slug_idx ON public.registrations USING btree (event_slug);


--
-- Name: registrations_teacher_member_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX registrations_teacher_member_id_idx ON public.registrations USING btree (teacher_member_id);


--
-- Name: session_action_templates_host_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_action_templates_host_idx ON public.session_action_templates USING btree (host_member_id, session_type);


--
-- Name: session_actions_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_actions_batch_idx ON public.session_actions USING btree (batch_id) WHERE (batch_id IS NOT NULL);


--
-- Name: session_actions_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_actions_cohort_idx ON public.session_actions USING btree (cohort_id);


--
-- Name: session_actions_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_actions_member_idx ON public.session_actions USING btree (member_id, is_done);


--
-- Name: session_actions_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_actions_session_idx ON public.session_actions USING btree (session_id);


--
-- Name: session_participants_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_participants_member_idx ON public.session_participants USING btree (member_id);


--
-- Name: sessions_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_cohort_idx ON public.sessions USING btree (cohort_id, scheduled_start);


--
-- Name: sessions_host_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_host_idx ON public.sessions USING btree (host_member_id, scheduled_start);


--
-- Name: sessions_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_member_idx ON public.sessions USING btree (member_id, scheduled_start);


--
-- Name: sessions_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_start_idx ON public.sessions USING btree (scheduled_start);


--
-- Name: sheet_watch_channels_channel_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sheet_watch_channels_channel_id_idx ON public.sheet_watch_channels USING btree (channel_id);


--
-- Name: sheet_watch_channels_registration_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sheet_watch_channels_registration_id_idx ON public.sheet_watch_channels USING btree (registration_id);


--
-- Name: store_event_discounts_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_event_discounts_event_idx ON public.store_event_discounts USING btree (event_slug);


--
-- Name: store_order_items_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_order_items_batch_idx ON public.store_order_items USING btree (batch_id);


--
-- Name: store_order_items_fulfillment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_order_items_fulfillment_idx ON public.store_order_items USING btree (fulfillment_status);


--
-- Name: store_order_items_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_order_items_order_idx ON public.store_order_items USING btree (order_id);


--
-- Name: store_order_items_participant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_order_items_participant_idx ON public.store_order_items USING btree (participant_member_id);


--
-- Name: store_orders_checkout_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_orders_checkout_idx ON public.store_orders USING btree (stripe_checkout_session_id);


--
-- Name: store_orders_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_orders_event_idx ON public.store_orders USING btree (event_slug);


--
-- Name: store_orders_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_orders_member_idx ON public.store_orders USING btree (member_id);


--
-- Name: store_orders_registration_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_orders_registration_idx ON public.store_orders USING btree (registration_id);


--
-- Name: store_returns_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_returns_order_idx ON public.store_returns USING btree (order_id);


--
-- Name: store_tier_discounts_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_tier_discounts_tier_idx ON public.store_tier_discounts USING btree (tier_id);


--
-- Name: store_variants_product_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX store_variants_product_idx ON public.store_variants USING btree (product_id);


--
-- Name: tier_grant_rules_object_trigger_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tier_grant_rules_object_trigger_idx ON public.tier_grant_rules USING btree (object_type, is_active) WHERE (trigger_type = 'object_created'::text);


--
-- Name: tier_grant_rules_trigger_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tier_grant_rules_trigger_idx ON public.tier_grant_rules USING btree (trigger_type, is_active, priority DESC);


--
-- Name: training_assignments_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_assignments_event_idx ON public.training_assignments USING btree (event_ref, event_role);


--
-- Name: training_certificates_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_certificates_member_idx ON public.training_certificates USING btree (member_id);


--
-- Name: training_enrollments_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_enrollments_member_idx ON public.training_enrollments USING btree (member_id);


--
-- Name: training_item_resources_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_item_resources_item_idx ON public.training_item_resources USING btree (item_id, display_order);


--
-- Name: training_items_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_items_module_idx ON public.training_items USING btree (module_id, display_order);


--
-- Name: training_items_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_items_section_idx ON public.training_items USING btree (section_id, display_order);


--
-- Name: training_modules_event_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_modules_event_ref_idx ON public.training_modules USING btree (event_ref) WHERE (event_ref IS NOT NULL);


--
-- Name: training_modules_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_modules_kind_idx ON public.training_modules USING btree (material_kind);


--
-- Name: training_progress_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_progress_item_idx ON public.training_progress USING btree (item_id);


--
-- Name: training_progress_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_progress_member_idx ON public.training_progress USING btree (member_id);


--
-- Name: training_sections_module_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX training_sections_module_idx ON public.training_sections USING btree (module_id, display_order);


--
-- Name: uniq_coaching_requests_member_live; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uniq_coaching_requests_member_live ON public.coaching_requests USING btree (member_id) WHERE (status = ANY (ARRAY['pending'::text, 'matched'::text, 'scheduled'::text]));


--
-- Name: volunteer_event_interest_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_event_interest_event_idx ON public.volunteer_event_interest USING btree (event_slug, status);


--
-- Name: volunteer_event_interest_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX volunteer_event_interest_member_idx ON public.volunteer_event_interest USING btree (member_id, status);


--
-- Name: bookings booking_guard; Type: TRIGGER; Schema: entitlements; Owner: -
--

CREATE TRIGGER booking_guard BEFORE INSERT OR UPDATE ON entitlements.bookings FOR EACH ROW EXECUTE FUNCTION entitlements.trg_booking_guard();


--
-- Name: discounts touch_discounts; Type: TRIGGER; Schema: entitlements; Owner: -
--

CREATE TRIGGER touch_discounts BEFORE UPDATE ON entitlements.discounts FOR EACH ROW EXECUTE FUNCTION entitlements.trg_touch_updated_at();


--
-- Name: event_settings event_settings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_settings_updated_at BEFORE UPDATE ON public.event_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: membership_tiers membership_tiers_ensure_space; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER membership_tiers_ensure_space AFTER INSERT ON public.membership_tiers FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_tier_space();


--
-- Name: participants participants_inherit_membership_id_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER participants_inherit_membership_id_trg BEFORE INSERT ON public.participants FOR EACH ROW EXECUTE FUNCTION public.participants_inherit_member_membership_id();


--
-- Name: registrations registrations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER registrations_updated_at BEFORE UPDATE ON public.registrations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: members trg_audit_members; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_members AFTER INSERT OR DELETE OR UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.audit_members();


--
-- Name: event_participations trg_event_participations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_event_participations_updated_at BEFORE UPDATE ON public.event_participations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: members trg_flag_manual_grade; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_flag_manual_grade BEFORE UPDATE OF grade ON public.members FOR EACH ROW EXECUTE FUNCTION public.flag_manual_grade_edit();


--
-- Name: member_memberships trg_member_memberships_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_member_memberships_updated_at BEFORE UPDATE ON public.member_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: members trg_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: membership_tiers trg_project_tier; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_project_tier AFTER INSERT OR DELETE OR UPDATE ON public.membership_tiers FOR EACH ROW EXECUTE FUNCTION entitlements.project_tier();


--
-- Name: schools trg_schools_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schools_updated_at BEFORE UPDATE ON public.schools FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: account_credit_ledger account_credit_ledger_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.account_credit_ledger
    ADD CONSTRAINT account_credit_ledger_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: account_credit_ledger account_credit_ledger_related_booking_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.account_credit_ledger
    ADD CONSTRAINT account_credit_ledger_related_booking_id_fkey FOREIGN KEY (related_booking_id) REFERENCES entitlements.bookings(id);


--
-- Name: bookings bookings_consumed_entitlement_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.bookings
    ADD CONSTRAINT bookings_consumed_entitlement_id_fkey FOREIGN KEY (consumed_entitlement_id) REFERENCES entitlements.entitlements(id);


--
-- Name: bookings bookings_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.bookings
    ADD CONSTRAINT bookings_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id);


--
-- Name: bookings bookings_offering_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.bookings
    ADD CONSTRAINT bookings_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES entitlements.offerings(id);


--
-- Name: coupon_redemptions coupon_redemptions_booking_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES entitlements.bookings(id);


--
-- Name: coupon_redemptions coupon_redemptions_discount_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_discount_id_fkey FOREIGN KEY (discount_id) REFERENCES entitlements.discounts(id) ON DELETE CASCADE;


--
-- Name: coupon_redemptions coupon_redemptions_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.coupon_redemptions
    ADD CONSTRAINT coupon_redemptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: discounts discounts_tier_code_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.discounts
    ADD CONSTRAINT discounts_tier_code_fkey FOREIGN KEY (tier_code) REFERENCES entitlements.tiers(code) ON DELETE CASCADE;


--
-- Name: entitlements entitlements_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.entitlements
    ADD CONSTRAINT entitlements_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: entitlements entitlements_offering_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.entitlements
    ADD CONSTRAINT entitlements_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES entitlements.offerings(id);


--
-- Name: member_grant_runs member_grant_runs_entitlement_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_entitlement_id_fkey FOREIGN KEY (entitlement_id) REFERENCES entitlements.entitlements(id);


--
-- Name: member_grant_runs member_grant_runs_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_grant_runs member_grant_runs_membership_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_membership_id_fkey FOREIGN KEY (membership_id) REFERENCES public.member_memberships(id) ON DELETE CASCADE;


--
-- Name: member_grant_runs member_grant_runs_tier_benefit_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.member_grant_runs
    ADD CONSTRAINT member_grant_runs_tier_benefit_id_fkey FOREIGN KEY (tier_benefit_id) REFERENCES entitlements.tier_benefits(id) ON DELETE CASCADE;


--
-- Name: offerings offerings_provider_member_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.offerings
    ADD CONSTRAINT offerings_provider_member_id_fkey FOREIGN KEY (provider_member_id) REFERENCES public.members(id);


--
-- Name: prices prices_offering_id_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.prices
    ADD CONSTRAINT prices_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES entitlements.offerings(id) ON DELETE CASCADE;


--
-- Name: tier_benefits tier_benefits_tier_code_fkey; Type: FK CONSTRAINT; Schema: entitlements; Owner: -
--

ALTER TABLE ONLY entitlements.tier_benefits
    ADD CONSTRAINT tier_benefits_tier_code_fkey FOREIGN KEY (tier_code) REFERENCES entitlements.tiers(code) ON DELETE CASCADE;


--
-- Name: account_credits account_credits_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_credits
    ADD CONSTRAINT account_credits_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: account_credits account_credits_source_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_credits
    ADD CONSTRAINT account_credits_source_registration_id_fkey FOREIGN KEY (source_registration_id) REFERENCES public.registrations(id) ON DELETE SET NULL;


--
-- Name: chat_channels chat_channels_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: chat_channels chat_channels_host_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_host_member_id_fkey FOREIGN KEY (host_member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: chat_channels chat_channels_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: chat_channels chat_channels_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_channels
    ADD CONSTRAINT chat_channels_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_author_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.chat_channels(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: chat_messages chat_messages_flagged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_flagged_by_fkey FOREIGN KEY (flagged_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: coaching_requests coaching_requests_coach_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_requests
    ADD CONSTRAINT coaching_requests_coach_id_fkey FOREIGN KEY (coach_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: coaching_requests coaching_requests_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_requests
    ADD CONSTRAINT coaching_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: coaching_requests coaching_requests_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_requests
    ADD CONSTRAINT coaching_requests_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: coaching_requests coaching_requests_workshop_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coaching_requests
    ADD CONSTRAINT coaching_requests_workshop_id_fkey FOREIGN KEY (workshop_id) REFERENCES public.mentoring_cohorts(id) ON DELETE SET NULL;


--
-- Name: cohort_members cohort_members_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_members
    ADD CONSTRAINT cohort_members_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: cohort_members cohort_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_members
    ADD CONSTRAINT cohort_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: cohort_training_links cohort_training_links_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_training_links
    ADD CONSTRAINT cohort_training_links_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: cohort_training_links cohort_training_links_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cohort_training_links
    ADD CONSTRAINT cohort_training_links_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: community_announcements community_announcements_author_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_announcements
    ADD CONSTRAINT community_announcements_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_announcements community_announcements_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_announcements
    ADD CONSTRAINT community_announcements_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_channels community_channels_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_channels
    ADD CONSTRAINT community_channels_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_comments community_comments_author_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_comments community_comments_parent_comment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES public.community_comments(id) ON DELETE CASCADE;


--
-- Name: community_comments community_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_comments
    ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: community_flags community_flags_flagged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_flags
    ADD CONSTRAINT community_flags_flagged_by_fkey FOREIGN KEY (flagged_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_flags community_flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_flags
    ADD CONSTRAINT community_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_notifications community_notifications_actor_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_notifications
    ADD CONSTRAINT community_notifications_actor_member_id_fkey FOREIGN KEY (actor_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_notifications community_notifications_recipient_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_notifications
    ADD CONSTRAINT community_notifications_recipient_member_id_fkey FOREIGN KEY (recipient_member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: community_post_reads community_post_reads_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_reads
    ADD CONSTRAINT community_post_reads_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: community_post_reads community_post_reads_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_post_reads
    ADD CONSTRAINT community_post_reads_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.community_posts(id) ON DELETE CASCADE;


--
-- Name: community_posts community_posts_author_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_posts community_posts_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.community_channels(id) ON DELETE CASCADE;


--
-- Name: community_posts community_posts_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_posts
    ADD CONSTRAINT community_posts_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_reactions community_reactions_author_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_reactions
    ADD CONSTRAINT community_reactions_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: community_resources community_resources_source_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_resources
    ADD CONSTRAINT community_resources_source_post_id_fkey FOREIGN KEY (source_post_id) REFERENCES public.community_posts(id) ON DELETE SET NULL;


--
-- Name: community_resources community_resources_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_resources
    ADD CONSTRAINT community_resources_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE SET NULL;


--
-- Name: community_resources community_resources_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_resources
    ADD CONSTRAINT community_resources_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_invites community_space_invites_claimed_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_invites
    ADD CONSTRAINT community_space_invites_claimed_member_id_fkey FOREIGN KEY (claimed_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_invites community_space_invites_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_invites
    ADD CONSTRAINT community_space_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_invites community_space_invites_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_invites
    ADD CONSTRAINT community_space_invites_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_members community_space_members_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_members
    ADD CONSTRAINT community_space_members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_members community_space_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_members
    ADD CONSTRAINT community_space_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: community_space_members community_space_members_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_members
    ADD CONSTRAINT community_space_members_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_roles community_space_roles_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_roles
    ADD CONSTRAINT community_space_roles_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_sources community_space_sources_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_sources
    ADD CONSTRAINT community_space_sources_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_sources community_space_sources_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_sources
    ADD CONSTRAINT community_space_sources_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_suspensions community_space_suspensions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_suspensions
    ADD CONSTRAINT community_space_suspensions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: community_space_suspensions community_space_suspensions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_suspensions
    ADD CONSTRAINT community_space_suspensions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: community_space_suspensions community_space_suspensions_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_suspensions
    ADD CONSTRAINT community_space_suspensions_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_tiers community_space_tiers_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_tiers
    ADD CONSTRAINT community_space_tiers_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_tiers community_space_tiers_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_tiers
    ADD CONSTRAINT community_space_tiers_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id) ON DELETE CASCADE;


--
-- Name: community_space_training community_space_training_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_training
    ADD CONSTRAINT community_space_training_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.community_spaces(id) ON DELETE CASCADE;


--
-- Name: community_space_training community_space_training_training_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_space_training
    ADD CONSTRAINT community_space_training_training_module_id_fkey FOREIGN KEY (training_module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: container_contents container_contents_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.container_contents
    ADD CONSTRAINT container_contents_container_id_fkey FOREIGN KEY (container_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: content_entitlements content_entitlements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_entitlements
    ADD CONSTRAINT content_entitlements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: content_entitlements content_entitlements_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_entitlements
    ADD CONSTRAINT content_entitlements_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id) ON DELETE CASCADE;


--
-- Name: course_object_assignments course_object_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_object_assignments
    ADD CONSTRAINT course_object_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: course_object_assignments course_object_assignments_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_object_assignments
    ADD CONSTRAINT course_object_assignments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: credit_redemptions credit_redemptions_credit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_credit_id_fkey FOREIGN KEY (credit_id) REFERENCES public.account_credits(id) ON DELETE CASCADE;


--
-- Name: credit_redemptions credit_redemptions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_redemptions
    ADD CONSTRAINT credit_redemptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: deletion_archive deletion_archive_deleted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_archive
    ADD CONSTRAINT deletion_archive_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: deletion_requests deletion_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: deletion_requests deletion_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: docusign_envelope_recipients docusign_envelope_recipients_envelope_row_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelope_recipients
    ADD CONSTRAINT docusign_envelope_recipients_envelope_row_fkey FOREIGN KEY (envelope_row) REFERENCES public.docusign_envelopes(id) ON DELETE CASCADE;


--
-- Name: docusign_envelopes docusign_envelopes_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: docusign_envelopes docusign_envelopes_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_participant_id_fkey FOREIGN KEY (participant_id) REFERENCES public.participants(id) ON DELETE CASCADE;


--
-- Name: docusign_envelopes docusign_envelopes_reused_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docusign_envelopes
    ADD CONSTRAINT docusign_envelopes_reused_from_fkey FOREIGN KEY (reused_from) REFERENCES public.docusign_envelopes(id) ON DELETE CASCADE;


--
-- Name: email_campaign_queue email_campaign_queue_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_queue
    ADD CONSTRAINT email_campaign_queue_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;


--
-- Name: email_campaign_queue email_campaign_queue_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_queue
    ADD CONSTRAINT email_campaign_queue_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: email_campaign_sends email_campaign_sends_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sends
    ADD CONSTRAINT email_campaign_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;


--
-- Name: email_campaign_sends email_campaign_sends_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sends
    ADD CONSTRAINT email_campaign_sends_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: email_campaigns email_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: email_campaigns email_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE RESTRICT;


--
-- Name: event_participations event_participations_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_participations
    ADD CONSTRAINT event_participations_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: event_refunds event_refunds_account_credit_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_refunds
    ADD CONSTRAINT event_refunds_account_credit_id_fkey FOREIGN KEY (account_credit_id) REFERENCES public.account_credits(id) ON DELETE SET NULL;


--
-- Name: event_refunds event_refunds_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_refunds
    ADD CONSTRAINT event_refunds_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: event_refunds event_refunds_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_refunds
    ADD CONSTRAINT event_refunds_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: event_refunds event_refunds_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_refunds
    ADD CONSTRAINT event_refunds_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE SET NULL;


--
-- Name: event_store_offerings event_store_offerings_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_store_offerings
    ADD CONSTRAINT event_store_offerings_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.store_variants(id) ON DELETE CASCADE;


--
-- Name: group_join_tokens group_join_tokens_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_join_tokens
    ADD CONSTRAINT group_join_tokens_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE;


--
-- Name: host_availability host_availability_host_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_availability
    ADD CONSTRAINT host_availability_host_member_id_fkey FOREIGN KEY (host_member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_activity_log member_activity_log_actor_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_activity_log
    ADD CONSTRAINT member_activity_log_actor_member_id_fkey FOREIGN KEY (actor_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: member_activity_log member_activity_log_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_activity_log
    ADD CONSTRAINT member_activity_log_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_addresses member_addresses_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_addresses
    ADD CONSTRAINT member_addresses_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_allergies member_allergies_allergy_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_allergies
    ADD CONSTRAINT member_allergies_allergy_option_id_fkey FOREIGN KEY (allergy_option_id) REFERENCES public.allergy_options(id) ON DELETE CASCADE;


--
-- Name: member_allergies member_allergies_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_allergies
    ADD CONSTRAINT member_allergies_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_background_checks member_background_checks_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_background_checks
    ADD CONSTRAINT member_background_checks_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_background_checks member_background_checks_ordered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_background_checks
    ADD CONSTRAINT member_background_checks_ordered_by_fkey FOREIGN KEY (ordered_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: member_directory_prefs member_directory_prefs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_directory_prefs
    ADD CONSTRAINT member_directory_prefs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_ethnicities member_ethnicities_ethnicity_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_ethnicities
    ADD CONSTRAINT member_ethnicities_ethnicity_option_id_fkey FOREIGN KEY (ethnicity_option_id) REFERENCES public.ethnicity_options(id) ON DELETE CASCADE;


--
-- Name: member_ethnicities member_ethnicities_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_ethnicities
    ADD CONSTRAINT member_ethnicities_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_group_members member_group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_group_members
    ADD CONSTRAINT member_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.member_groups(id) ON DELETE CASCADE;


--
-- Name: member_group_members member_group_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_group_members
    ADD CONSTRAINT member_group_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_groups member_groups_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_groups
    ADD CONSTRAINT member_groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_memberships member_memberships_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_memberships member_memberships_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_memberships
    ADD CONSTRAINT member_memberships_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id);


--
-- Name: member_notification_prefs member_notification_prefs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_notification_prefs
    ADD CONSTRAINT member_notification_prefs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_roles member_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.members(id);


--
-- Name: member_roles member_roles_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_roles
    ADD CONSTRAINT member_roles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_schools member_schools_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_schools
    ADD CONSTRAINT member_schools_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_schools member_schools_school_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_schools
    ADD CONSTRAINT member_schools_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id);


--
-- Name: member_teacher_licenses member_teacher_licenses_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teacher_licenses
    ADD CONSTRAINT member_teacher_licenses_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_teacher_licenses member_teacher_licenses_verified_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_teacher_licenses
    ADD CONSTRAINT member_teacher_licenses_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: mentoring_cohorts mentoring_cohorts_mentor_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentoring_cohorts
    ADD CONSTRAINT mentoring_cohorts_mentor_member_id_fkey FOREIGN KEY (mentor_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: mentoring_cohorts mentoring_cohorts_parent_container_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentoring_cohorts
    ADD CONSTRAINT mentoring_cohorts_parent_container_id_fkey FOREIGN KEY (parent_container_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: mentoring_cohorts mentoring_cohorts_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mentoring_cohorts
    ADD CONSTRAINT mentoring_cohorts_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE;


--
-- Name: merch_batches merch_batches_committed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_batches
    ADD CONSTRAINT merch_batches_committed_by_fkey FOREIGN KEY (committed_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: merch_batches merch_batches_owner_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merch_batches
    ADD CONSTRAINT merch_batches_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: object_roles object_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_roles
    ADD CONSTRAINT object_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: object_roles object_roles_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.object_roles
    ADD CONSTRAINT object_roles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: participants participants_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.event_companies(id) ON DELETE SET NULL;


--
-- Name: participants participants_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: participants participants_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.participants
    ADD CONSTRAINT participants_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE;


--
-- Name: refund_policies refund_policies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_policies
    ADD CONSTRAINT refund_policies_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: registrations registrations_invoice_paid_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_invoice_paid_by_fkey FOREIGN KEY (invoice_paid_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: registrations registrations_teacher_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registrations
    ADD CONSTRAINT registrations_teacher_member_id_fkey FOREIGN KEY (teacher_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: sent_reminders sent_reminders_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sent_reminders
    ADD CONSTRAINT sent_reminders_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: session_action_templates session_action_templates_host_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_action_templates
    ADD CONSTRAINT session_action_templates_host_member_id_fkey FOREIGN KEY (host_member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: session_actions session_actions_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.mentoring_cohorts(id) ON DELETE CASCADE;


--
-- Name: session_actions session_actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: session_actions session_actions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: session_actions session_actions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: session_actions session_actions_training_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_actions
    ADD CONSTRAINT session_actions_training_module_id_fkey FOREIGN KEY (training_module_id) REFERENCES public.training_modules(id) ON DELETE SET NULL;


--
-- Name: session_hosts session_hosts_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_hosts
    ADD CONSTRAINT session_hosts_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: session_hosts session_hosts_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_hosts
    ADD CONSTRAINT session_hosts_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: session_participants session_participants_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: session_participants session_participants_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_participants
    ADD CONSTRAINT session_participants_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.mentoring_cohorts(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_host_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_host_member_id_fkey FOREIGN KEY (host_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: sessions sessions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: sheet_watch_channels sheet_watch_channels_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheet_watch_channels
    ADD CONSTRAINT sheet_watch_channels_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE CASCADE;


--
-- Name: staff_roles staff_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_roles
    ADD CONSTRAINT staff_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: staff_roles staff_roles_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_roles
    ADD CONSTRAINT staff_roles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: store_event_discounts store_event_discounts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_event_discounts
    ADD CONSTRAINT store_event_discounts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.store_products(id) ON DELETE CASCADE;


--
-- Name: store_order_items store_order_items_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_order_items
    ADD CONSTRAINT store_order_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.merch_batches(id) ON DELETE SET NULL;


--
-- Name: store_order_items store_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_order_items
    ADD CONSTRAINT store_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.store_orders(id) ON DELETE CASCADE;


--
-- Name: store_order_items store_order_items_participant_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_order_items
    ADD CONSTRAINT store_order_items_participant_member_id_fkey FOREIGN KEY (participant_member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: store_order_items store_order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_order_items
    ADD CONSTRAINT store_order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.store_variants(id) ON DELETE SET NULL;


--
-- Name: store_orders store_orders_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_orders
    ADD CONSTRAINT store_orders_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: store_orders store_orders_registration_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_orders
    ADD CONSTRAINT store_orders_registration_id_fkey FOREIGN KEY (registration_id) REFERENCES public.registrations(id) ON DELETE SET NULL;


--
-- Name: store_returns store_returns_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_returns
    ADD CONSTRAINT store_returns_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: store_returns store_returns_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_returns
    ADD CONSTRAINT store_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.store_orders(id) ON DELETE CASCADE;


--
-- Name: store_tier_discounts store_tier_discounts_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_tier_discounts
    ADD CONSTRAINT store_tier_discounts_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.store_products(id) ON DELETE CASCADE;


--
-- Name: store_tier_discounts store_tier_discounts_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_tier_discounts
    ADD CONSTRAINT store_tier_discounts_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES public.membership_tiers(id) ON DELETE CASCADE;


--
-- Name: store_variants store_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.store_variants
    ADD CONSTRAINT store_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.store_products(id) ON DELETE CASCADE;


--
-- Name: tier_grant_rules tier_grant_rules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tier_grant_rules
    ADD CONSTRAINT tier_grant_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: tier_grant_rules tier_grant_rules_grant_tier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tier_grant_rules
    ADD CONSTRAINT tier_grant_rules_grant_tier_id_fkey FOREIGN KEY (grant_tier_id) REFERENCES public.membership_tiers(id) ON DELETE CASCADE;


--
-- Name: training_assignments training_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assignments
    ADD CONSTRAINT training_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: training_assignments training_assignments_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_assignments
    ADD CONSTRAINT training_assignments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: training_certificates training_certificates_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: training_certificates training_certificates_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_certificates
    ADD CONSTRAINT training_certificates_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: training_enrollments training_enrollments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments
    ADD CONSTRAINT training_enrollments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: training_enrollments training_enrollments_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_enrollments
    ADD CONSTRAINT training_enrollments_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: training_item_resources training_item_resources_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_item_resources
    ADD CONSTRAINT training_item_resources_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.training_items(id) ON DELETE CASCADE;


--
-- Name: training_items training_items_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_items
    ADD CONSTRAINT training_items_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: training_items training_items_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_items
    ADD CONSTRAINT training_items_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.training_sections(id) ON DELETE SET NULL;


--
-- Name: training_modules training_modules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_modules
    ADD CONSTRAINT training_modules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: training_progress training_progress_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_progress
    ADD CONSTRAINT training_progress_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.training_items(id) ON DELETE CASCADE;


--
-- Name: training_progress training_progress_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_progress
    ADD CONSTRAINT training_progress_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: training_sections training_sections_module_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_sections
    ADD CONSTRAINT training_sections_module_id_fkey FOREIGN KEY (module_id) REFERENCES public.training_modules(id) ON DELETE CASCADE;


--
-- Name: volunteer_event_interest volunteer_event_interest_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.volunteer_event_interest
    ADD CONSTRAINT volunteer_event_interest_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: account_credit_ledger; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.account_credit_ledger ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: coupon_redemptions; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.coupon_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: discounts; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.discounts ENABLE ROW LEVEL SECURITY;

--
-- Name: entitlements; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: member_grant_runs; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.member_grant_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: offerings; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.offerings ENABLE ROW LEVEL SECURITY;

--
-- Name: prices; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.prices ENABLE ROW LEVEL SECURITY;

--
-- Name: processed_events; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.processed_events ENABLE ROW LEVEL SECURITY;

--
-- Name: tier_benefits; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.tier_benefits ENABLE ROW LEVEL SECURITY;

--
-- Name: tiers; Type: ROW SECURITY; Schema: entitlements; Owner: -
--

ALTER TABLE entitlements.tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: account_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: allergy_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.allergy_options ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: coaching_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coaching_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: cohort_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cohort_members ENABLE ROW LEVEL SECURITY;

--
-- Name: cohort_training_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cohort_training_links ENABLE ROW LEVEL SECURITY;

--
-- Name: community_announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: community_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: community_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;

--
-- Name: community_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: community_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: community_post_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_post_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: community_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: community_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: community_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_invites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_invites ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_members ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_suspensions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_suspensions ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_training; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_space_training ENABLE ROW LEVEL SECURITY;

--
-- Name: community_spaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: container_contents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.container_contents ENABLE ROW LEVEL SECURITY;

--
-- Name: content_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: content_persistence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_persistence ENABLE ROW LEVEL SECURITY;

--
-- Name: content_prerequisites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.content_prerequisites ENABLE ROW LEVEL SECURITY;

--
-- Name: course_object_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.course_object_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: credit_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.credit_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: deletion_archive; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deletion_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: deletion_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deletion_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: docusign_envelope_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.docusign_envelope_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: docusign_envelopes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.docusign_envelopes ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaign_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_campaign_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaign_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_campaign_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: ethnicity_options; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ethnicity_options ENABLE ROW LEVEL SECURITY;

--
-- Name: event_companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: event_manager_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_manager_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: event_participations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_participations ENABLE ROW LEVEL SECURITY;

--
-- Name: event_refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: event_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: event_store_offerings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_store_offerings ENABLE ROW LEVEL SECURITY;

--
-- Name: group_join_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.group_join_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: host_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.host_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: lead_capture_failures; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lead_capture_failures ENABLE ROW LEVEL SECURITY;

--
-- Name: member_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: member_addresses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_addresses ENABLE ROW LEVEL SECURITY;

--
-- Name: member_allergies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_allergies ENABLE ROW LEVEL SECURITY;

--
-- Name: member_background_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_background_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: member_directory_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_directory_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: member_ethnicities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_ethnicities ENABLE ROW LEVEL SECURITY;

--
-- Name: member_group_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_group_members ENABLE ROW LEVEL SECURITY;

--
-- Name: member_group_members member_group_members_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_group_members_service_all ON public.member_group_members TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_groups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_groups ENABLE ROW LEVEL SECURITY;

--
-- Name: member_groups member_groups_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_groups_service_all ON public.member_groups TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: member_notification_prefs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_notification_prefs ENABLE ROW LEVEL SECURITY;

--
-- Name: member_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: member_roles member_roles_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_roles_service_all ON public.member_roles TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_schools ENABLE ROW LEVEL SECURITY;

--
-- Name: member_teacher_licenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.member_teacher_licenses ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: community_comments members read accessible space comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read accessible space comments" ON public.community_comments FOR SELECT TO authenticated USING (((status = 'published'::text) AND public.can_read_space(( SELECT c.space_id
   FROM (public.community_channels c
     JOIN public.community_posts p ON ((p.channel_id = c.id)))
  WHERE (p.id = community_comments.post_id)), (auth.jwt() ->> 'sub'::text))));


--
-- Name: community_posts members read accessible space posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read accessible space posts" ON public.community_posts FOR SELECT TO authenticated USING (((status = 'published'::text) AND (channel_id IS NOT NULL) AND public.can_read_space(( SELECT c.space_id
   FROM public.community_channels c
  WHERE (c.id = community_posts.channel_id)), (auth.jwt() ->> 'sub'::text))));


--
-- Name: chat_messages members read own channel messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "members read own channel messages" ON public.chat_messages FOR SELECT TO authenticated USING (public.can_read_chat_channel(channel_id, (auth.jwt() ->> 'sub'::text)));


--
-- Name: members members_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_admin_all ON public.members USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: members members_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_self_read ON public.members FOR SELECT USING (((auth.uid())::text = clerk_user_id));


--
-- Name: members members_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY members_self_update ON public.members FOR UPDATE USING (((auth.uid())::text = clerk_user_id));


--
-- Name: membership_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: mentoring_cohorts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mentoring_cohorts ENABLE ROW LEVEL SECURITY;

--
-- Name: merch_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.merch_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: object_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.object_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: object_type_relations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.object_type_relations ENABLE ROW LEVEL SECURITY;

--
-- Name: object_type_relations object_type_relations_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY object_type_relations_service_all ON public.object_type_relations TO service_role USING (true) WITH CHECK (true);


--
-- Name: object_type_singleton_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.object_type_singleton_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: object_type_singleton_roles object_type_singleton_roles_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY object_type_singleton_roles_service_all ON public.object_type_singleton_roles TO service_role USING (true) WITH CHECK (true);


--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_pricing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_pricing ENABLE ROW LEVEL SECURITY;

--
-- Name: refund_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refund_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: schools; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

--
-- Name: sent_reminders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sent_reminders ENABLE ROW LEVEL SECURITY;

--
-- Name: community_space_roles service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role" ON public.community_space_roles TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_sources service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role" ON public.community_space_sources TO service_role USING (true) WITH CHECK (true);


--
-- Name: sheet_watch_channels service role full access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access" ON public.sheet_watch_channels TO service_role USING (true) WITH CHECK (true);


--
-- Name: account_credits service role full access account_credits; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access account_credits" ON public.account_credits TO service_role USING (true) WITH CHECK (true);


--
-- Name: allergy_options service role full access allergy_options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access allergy_options" ON public.allergy_options TO service_role USING (true) WITH CHECK (true);


--
-- Name: chat_channels service role full access chat_channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access chat_channels" ON public.chat_channels TO service_role USING (true) WITH CHECK (true);


--
-- Name: coaching_requests service role full access coaching_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access coaching_requests" ON public.coaching_requests TO service_role USING (true) WITH CHECK (true);


--
-- Name: cohort_members service role full access cohort_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access cohort_members" ON public.cohort_members TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_announcements service role full access community_announcements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_announcements" ON public.community_announcements TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_channels service role full access community_channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_channels" ON public.community_channels TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_comments service role full access community_comments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_comments" ON public.community_comments TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_flags service role full access community_flags; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_flags" ON public.community_flags TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_notifications service role full access community_notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_notifications" ON public.community_notifications TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_posts service role full access community_posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_posts" ON public.community_posts TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_reactions service role full access community_reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_reactions" ON public.community_reactions TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_resources service role full access community_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_resources" ON public.community_resources TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_invites service role full access community_space_invites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_space_invites" ON public.community_space_invites TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_members service role full access community_space_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_space_members" ON public.community_space_members TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_suspensions service role full access community_space_suspensions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_space_suspensions" ON public.community_space_suspensions TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_tiers service role full access community_space_tiers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_space_tiers" ON public.community_space_tiers TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_space_training service role full access community_space_training; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_space_training" ON public.community_space_training TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_spaces service role full access community_spaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access community_spaces" ON public.community_spaces TO service_role USING (true) WITH CHECK (true);


--
-- Name: content_entitlements service role full access content_entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access content_entitlements" ON public.content_entitlements TO service_role USING (true) WITH CHECK (true);


--
-- Name: content_persistence service role full access content_persistence; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access content_persistence" ON public.content_persistence TO service_role USING (true) WITH CHECK (true);


--
-- Name: content_prerequisites service role full access content_prerequisites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access content_prerequisites" ON public.content_prerequisites TO service_role USING (true) WITH CHECK (true);


--
-- Name: course_object_assignments service role full access course_object_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access course_object_assignments" ON public.course_object_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: credit_redemptions service role full access credit_redemptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access credit_redemptions" ON public.credit_redemptions TO service_role USING (true) WITH CHECK (true);


--
-- Name: deletion_archive service role full access deletion_archive; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access deletion_archive" ON public.deletion_archive TO service_role USING (true) WITH CHECK (true);


--
-- Name: deletion_requests service role full access deletion_requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access deletion_requests" ON public.deletion_requests TO service_role USING (true) WITH CHECK (true);


--
-- Name: docusign_envelope_recipients service role full access docusign_envelope_recipients; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access docusign_envelope_recipients" ON public.docusign_envelope_recipients TO service_role USING (true) WITH CHECK (true);


--
-- Name: docusign_envelopes service role full access docusign_envelopes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access docusign_envelopes" ON public.docusign_envelopes TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_campaign_queue service role full access email_campaign_queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access email_campaign_queue" ON public.email_campaign_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_campaign_sends service role full access email_campaign_sends; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access email_campaign_sends" ON public.email_campaign_sends TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_campaigns service role full access email_campaigns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access email_campaigns" ON public.email_campaigns TO service_role USING (true) WITH CHECK (true);


--
-- Name: email_templates service role full access email_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access email_templates" ON public.email_templates TO service_role USING (true) WITH CHECK (true);


--
-- Name: ethnicity_options service role full access ethnicity_options; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access ethnicity_options" ON public.ethnicity_options TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_companies service role full access event_companies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_companies" ON public.event_companies TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_manager_assignments service role full access event_manager_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_manager_assignments" ON public.event_manager_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_participations service role full access event_participations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_participations" ON public.event_participations TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_refunds service role full access event_refunds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_refunds" ON public.event_refunds TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_settings service role full access event_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_settings" ON public.event_settings TO service_role USING (true) WITH CHECK (true);


--
-- Name: event_store_offerings service role full access event_store_offerings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access event_store_offerings" ON public.event_store_offerings TO service_role USING (true) WITH CHECK (true);


--
-- Name: group_join_tokens service role full access group_join_tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access group_join_tokens" ON public.group_join_tokens TO service_role USING (true) WITH CHECK (true);


--
-- Name: host_availability service role full access host_availability; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access host_availability" ON public.host_availability TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_activity_log service role full access member_activity_log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_activity_log" ON public.member_activity_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_addresses service role full access member_addresses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_addresses" ON public.member_addresses TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_allergies service role full access member_allergies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_allergies" ON public.member_allergies TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_directory_prefs service role full access member_directory_prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_directory_prefs" ON public.member_directory_prefs TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_ethnicities service role full access member_ethnicities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_ethnicities" ON public.member_ethnicities TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_notification_prefs service role full access member_notification_prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access member_notification_prefs" ON public.member_notification_prefs TO service_role USING (true) WITH CHECK (true);


--
-- Name: mentoring_cohorts service role full access mentoring_cohorts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access mentoring_cohorts" ON public.mentoring_cohorts TO service_role USING (true) WITH CHECK (true);


--
-- Name: merch_batches service role full access merch_batches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access merch_batches" ON public.merch_batches TO service_role USING (true) WITH CHECK (true);


--
-- Name: object_roles service role full access object_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access object_roles" ON public.object_roles TO service_role USING (true) WITH CHECK (true);


--
-- Name: participants service role full access participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access participants" ON public.participants TO service_role USING (true) WITH CHECK (true);


--
-- Name: platform_pricing service role full access platform_pricing; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access platform_pricing" ON public.platform_pricing TO service_role USING (true) WITH CHECK (true);


--
-- Name: refund_policies service role full access refund_policies; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access refund_policies" ON public.refund_policies TO service_role USING (true) WITH CHECK (true);


--
-- Name: registrations service role full access registrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access registrations" ON public.registrations TO service_role USING (true) WITH CHECK (true);


--
-- Name: sent_reminders service role full access sent_reminders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access sent_reminders" ON public.sent_reminders TO service_role USING (true) WITH CHECK (true);


--
-- Name: session_action_templates service role full access session_action_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access session_action_templates" ON public.session_action_templates TO service_role USING (true) WITH CHECK (true);


--
-- Name: session_actions service role full access session_actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access session_actions" ON public.session_actions TO service_role USING (true) WITH CHECK (true);


--
-- Name: session_hosts service role full access session_hosts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access session_hosts" ON public.session_hosts TO service_role USING (true) WITH CHECK (true);


--
-- Name: session_participants service role full access session_participants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access session_participants" ON public.session_participants TO service_role USING (true) WITH CHECK (true);


--
-- Name: sessions service role full access sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access sessions" ON public.sessions TO service_role USING (true) WITH CHECK (true);


--
-- Name: staff_roles service role full access staff_roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access staff_roles" ON public.staff_roles TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_event_discounts service role full access store_event_discounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_event_discounts" ON public.store_event_discounts TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_order_items service role full access store_order_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_order_items" ON public.store_order_items TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_orders service role full access store_orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_orders" ON public.store_orders TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_products service role full access store_products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_products" ON public.store_products TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_returns service role full access store_returns; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_returns" ON public.store_returns TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_tier_discounts service role full access store_tier_discounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_tier_discounts" ON public.store_tier_discounts TO service_role USING (true) WITH CHECK (true);


--
-- Name: store_variants service role full access store_variants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access store_variants" ON public.store_variants TO service_role USING (true) WITH CHECK (true);


--
-- Name: tier_grant_rules service role full access tier_grant_rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access tier_grant_rules" ON public.tier_grant_rules TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_assignments service role full access training_assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_assignments" ON public.training_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_certificates service role full access training_certificates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_certificates" ON public.training_certificates TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_enrollments service role full access training_enrollments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_enrollments" ON public.training_enrollments TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_item_resources service role full access training_item_resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_item_resources" ON public.training_item_resources TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_items service role full access training_items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_items" ON public.training_items TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_modules service role full access training_modules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_modules" ON public.training_modules TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_progress service role full access training_progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_progress" ON public.training_progress TO service_role USING (true) WITH CHECK (true);


--
-- Name: training_sections service role full access training_sections; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access training_sections" ON public.training_sections TO service_role USING (true) WITH CHECK (true);


--
-- Name: volunteer_event_interest service role full access volunteer_event_interest; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role full access volunteer_event_interest" ON public.volunteer_event_interest TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_background_checks service_role all background_checks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all background_checks" ON public.member_background_checks TO service_role USING (true) WITH CHECK (true);


--
-- Name: chat_messages service_role all chat_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all chat_messages" ON public.chat_messages TO service_role USING (true) WITH CHECK (true);


--
-- Name: cohort_training_links service_role all cohort_training_links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all cohort_training_links" ON public.cohort_training_links TO service_role USING (true) WITH CHECK (true);


--
-- Name: container_contents service_role all container_contents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all container_contents" ON public.container_contents TO service_role USING (true) WITH CHECK (true);


--
-- Name: community_post_reads service_role all post_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all post_reads" ON public.community_post_reads TO service_role USING (true) WITH CHECK (true);


--
-- Name: member_teacher_licenses service_role all teacher_licenses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service_role all teacher_licenses" ON public.member_teacher_licenses TO service_role USING (true) WITH CHECK (true);


--
-- Name: session_action_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_action_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: session_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: session_hosts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_hosts ENABLE ROW LEVEL SECURITY;

--
-- Name: session_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sheet_watch_channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sheet_watch_channels ENABLE ROW LEVEL SECURITY;

--
-- Name: staff_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: store_event_discounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_event_discounts ENABLE ROW LEVEL SECURITY;

--
-- Name: store_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: store_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: store_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;

--
-- Name: store_returns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_returns ENABLE ROW LEVEL SECURITY;

--
-- Name: store_tier_discounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_tier_discounts ENABLE ROW LEVEL SECURITY;

--
-- Name: store_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.store_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: tier_grant_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tier_grant_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: training_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: training_certificates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_certificates ENABLE ROW LEVEL SECURITY;

--
-- Name: training_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: training_item_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_item_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: training_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_items ENABLE ROW LEVEL SECURITY;

--
-- Name: training_modules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;

--
-- Name: training_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: training_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.training_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: video_watermark_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.video_watermark_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: volunteer_event_interest; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.volunteer_event_interest ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA entitlements; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA entitlements TO service_role;
GRANT USAGE ON SCHEMA entitlements TO anon;
GRANT USAGE ON SCHEMA entitlements TO authenticated;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION fn_active_tier(p_member uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_active_tier(p_member uuid) TO service_role;


--
-- Name: FUNCTION fn_allocation_balance(p_member uuid, p_kind entitlements.entitlement_kind, p_offering uuid, p_offering_type entitlements.offering_type); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_allocation_balance(p_member uuid, p_kind entitlements.entitlement_kind, p_offering uuid, p_offering_type entitlements.offering_type) TO service_role;


--
-- Name: FUNCTION fn_base_price_cents(p_offering uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_base_price_cents(p_offering uuid) TO service_role;


--
-- Name: FUNCTION fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid) TO service_role;


--
-- Name: FUNCTION fn_cancel_cohort(p_offering uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_cancel_cohort(p_offering uuid) TO service_role;


--
-- Name: FUNCTION fn_claim_event(p_event_id text, p_type text); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_claim_event(p_event_id text, p_type text) TO service_role;


--
-- Name: FUNCTION fn_confirm_paid_booking(p_member uuid, p_offering uuid, p_stripe_payment text, p_amount_charged_cents integer, p_credit_applied_cents integer, p_participant uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_confirm_paid_booking(p_member uuid, p_offering uuid, p_stripe_payment text, p_amount_charged_cents integer, p_credit_applied_cents integer, p_participant uuid) TO service_role;


--
-- Name: FUNCTION fn_credit_balance(p_member uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_credit_balance(p_member uuid) TO service_role;


--
-- Name: FUNCTION fn_expire_lapsed_grants(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_expire_lapsed_grants() TO service_role;


--
-- Name: FUNCTION fn_grant_adhoc(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_source_ref text, p_expires_at timestamp with time zone); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_grant_adhoc(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_source_ref text, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION fn_grant_member_benefits(p_membership uuid, p_as_of timestamp with time zone); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_grant_member_benefits(p_membership uuid, p_as_of timestamp with time zone) TO service_role;


--
-- Name: FUNCTION fn_grant_purchased(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_stripe_session text, p_expires_at timestamp with time zone); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_grant_purchased(p_member uuid, p_kind entitlements.entitlement_kind, p_quantity integer, p_stripe_session text, p_expires_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION fn_kind_to_offering(p_kind entitlements.entitlement_kind); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_kind_to_offering(p_kind entitlements.entitlement_kind) TO service_role;


--
-- Name: FUNCTION fn_mark_no_show(p_booking uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_mark_no_show(p_booking uuid) TO service_role;


--
-- Name: FUNCTION fn_period_start(p_period text, p_as_of timestamp with time zone, p_started timestamp with time zone); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_period_start(p_period text, p_as_of timestamp with time zone, p_started timestamp with time zone) TO service_role;


--
-- Name: FUNCTION fn_purchase_expiry(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_purchase_expiry() TO service_role;


--
-- Name: FUNCTION fn_quote(p_member uuid, p_offering uuid, p_coupon text); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_quote(p_member uuid, p_offering uuid, p_coupon text) TO service_role;


--
-- Name: FUNCTION fn_redeem_coupon(p_code text, p_member uuid, p_booking uuid, p_amount_cents integer); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_redeem_coupon(p_code text, p_member uuid, p_booking uuid, p_amount_cents integer) TO service_role;


--
-- Name: FUNCTION fn_refund_entitlement(p_entitlement uuid, p_mode text, p_amount_cents integer); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_refund_entitlement(p_entitlement uuid, p_mode text, p_amount_cents integer) TO service_role;


--
-- Name: FUNCTION fn_regrant_periodic(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_regrant_periodic() TO service_role;


--
-- Name: FUNCTION fn_release_one_booking(p_member uuid, p_offering uuid); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_release_one_booking(p_member uuid, p_offering uuid) TO service_role;


--
-- Name: FUNCTION fn_sync_cohort_offerings(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_sync_cohort_offerings() TO service_role;


--
-- Name: FUNCTION fn_tier_discount_pct(p_member uuid, p_type entitlements.offering_type); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_tier_discount_pct(p_member uuid, p_type entitlements.offering_type) TO service_role;


--
-- Name: TABLE discounts; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.discounts TO service_role;


--
-- Name: FUNCTION fn_validate_coupon(p_code text, p_type entitlements.offering_type); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.fn_validate_coupon(p_code text, p_type entitlements.offering_type) TO service_role;


--
-- Name: FUNCTION project_tier(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.project_tier() TO service_role;


--
-- Name: FUNCTION trg_booking_guard(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.trg_booking_guard() TO service_role;


--
-- Name: FUNCTION trg_touch_updated_at(); Type: ACL; Schema: entitlements; Owner: -
--

GRANT ALL ON FUNCTION entitlements.trg_touch_updated_at() TO service_role;


--
-- Name: FUNCTION audit_members(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.audit_members() TO anon;
GRANT ALL ON FUNCTION public.audit_members() TO authenticated;
GRANT ALL ON FUNCTION public.audit_members() TO service_role;


--
-- Name: FUNCTION can_read_chat_channel(_channel_id uuid, _clerk_sub text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_chat_channel(_channel_id uuid, _clerk_sub text) TO service_role;


--
-- Name: FUNCTION can_read_space(p_space_id uuid, p_clerk_user_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.can_read_space(p_space_id uuid, p_clerk_user_id text) TO service_role;


--
-- Name: FUNCTION decrement_post_comment_count(p_post_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.decrement_post_comment_count(p_post_id uuid) TO anon;
GRANT ALL ON FUNCTION public.decrement_post_comment_count(p_post_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.decrement_post_comment_count(p_post_id uuid) TO service_role;


--
-- Name: FUNCTION ensure_tier_space(p_tier_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.ensure_tier_space(p_tier_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.ensure_tier_space(p_tier_id uuid) TO service_role;


--
-- Name: FUNCTION event_slug_inventory(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.event_slug_inventory() FROM PUBLIC;
GRANT ALL ON FUNCTION public.event_slug_inventory() TO service_role;


--
-- Name: FUNCTION event_slug_row_counts(p_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.event_slug_row_counts(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.event_slug_row_counts(p_slug text) TO service_role;


--
-- Name: FUNCTION flag_manual_grade_edit(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.flag_manual_grade_edit() TO anon;
GRANT ALL ON FUNCTION public.flag_manual_grade_edit() TO authenticated;
GRANT ALL ON FUNCTION public.flag_manual_grade_edit() TO service_role;


--
-- Name: FUNCTION increment_post_comment_count(p_post_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_post_comment_count(p_post_id uuid) TO anon;
GRANT ALL ON FUNCTION public.increment_post_comment_count(p_post_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.increment_post_comment_count(p_post_id uuid) TO service_role;


--
-- Name: FUNCTION increment_resource_download(rid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_resource_download(rid uuid) TO anon;
GRANT ALL ON FUNCTION public.increment_resource_download(rid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.increment_resource_download(rid uuid) TO service_role;


--
-- Name: FUNCTION participants_inherit_member_membership_id(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.participants_inherit_member_membership_id() TO anon;
GRANT ALL ON FUNCTION public.participants_inherit_member_membership_id() TO authenticated;
GRANT ALL ON FUNCTION public.participants_inherit_member_membership_id() TO service_role;


--
-- Name: FUNCTION promote_grades(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.promote_grades() TO anon;
GRANT ALL ON FUNCTION public.promote_grades() TO authenticated;
GRANT ALL ON FUNCTION public.promote_grades() TO service_role;


--
-- Name: FUNCTION rename_event_slug(p_old text, p_new text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.rename_event_slug(p_old text, p_new text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.rename_event_slug(p_old text, p_new text) TO service_role;


--
-- Name: FUNCTION set_training_progress(p_member_id uuid, p_item_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_training_progress(p_member_id uuid, p_item_id uuid, p_status text) TO anon;
GRANT ALL ON FUNCTION public.set_training_progress(p_member_id uuid, p_item_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.set_training_progress(p_member_id uuid, p_item_id uuid, p_status text) TO service_role;


--
-- Name: FUNCTION set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_updated_at() TO service_role;


--
-- Name: FUNCTION space_unread_counts(_member_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.space_unread_counts(_member_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.space_unread_counts(_member_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.space_unread_counts(_member_id uuid) TO service_role;


--
-- Name: FUNCTION tg_ensure_tier_space(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tg_ensure_tier_space() TO anon;
GRANT ALL ON FUNCTION public.tg_ensure_tier_space() TO authenticated;
GRANT ALL ON FUNCTION public.tg_ensure_tier_space() TO service_role;


--
-- Name: FUNCTION tier_space_slug(p_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tier_space_slug(p_name text) TO anon;
GRANT ALL ON FUNCTION public.tier_space_slug(p_name text) TO authenticated;
GRANT ALL ON FUNCTION public.tier_space_slug(p_name text) TO service_role;


--
-- Name: TABLE account_credit_ledger; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.account_credit_ledger TO service_role;


--
-- Name: TABLE bookings; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.bookings TO service_role;


--
-- Name: TABLE coupon_redemptions; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.coupon_redemptions TO service_role;


--
-- Name: TABLE entitlements; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.entitlements TO service_role;


--
-- Name: TABLE member_grant_runs; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.member_grant_runs TO service_role;


--
-- Name: TABLE offerings; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.offerings TO service_role;


--
-- Name: TABLE prices; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.prices TO service_role;


--
-- Name: TABLE processed_events; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.processed_events TO service_role;


--
-- Name: TABLE tier_benefits; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.tier_benefits TO service_role;


--
-- Name: TABLE tiers; Type: ACL; Schema: entitlements; Owner: -
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE entitlements.tiers TO service_role;


--
-- Name: TABLE member_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_roles TO anon;
GRANT ALL ON TABLE public.member_roles TO authenticated;
GRANT ALL ON TABLE public.member_roles TO service_role;


--
-- Name: TABLE object_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.object_roles TO anon;
GRANT ALL ON TABLE public.object_roles TO authenticated;
GRANT ALL ON TABLE public.object_roles TO service_role;


--
-- Name: TABLE access_redundancy_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_redundancy_audit TO anon;
GRANT ALL ON TABLE public.access_redundancy_audit TO authenticated;
GRANT ALL ON TABLE public.access_redundancy_audit TO service_role;


--
-- Name: TABLE account_credits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.account_credits TO anon;
GRANT ALL ON TABLE public.account_credits TO authenticated;
GRANT ALL ON TABLE public.account_credits TO service_role;


--
-- Name: TABLE allergy_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.allergy_options TO anon;
GRANT ALL ON TABLE public.allergy_options TO authenticated;
GRANT ALL ON TABLE public.allergy_options TO service_role;


--
-- Name: TABLE audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_log TO anon;
GRANT ALL ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;


--
-- Name: TABLE chat_channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_channels TO anon;
GRANT ALL ON TABLE public.chat_channels TO authenticated;
GRANT ALL ON TABLE public.chat_channels TO service_role;


--
-- Name: TABLE chat_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.chat_messages TO anon;
GRANT ALL ON TABLE public.chat_messages TO authenticated;
GRANT ALL ON TABLE public.chat_messages TO service_role;


--
-- Name: TABLE coaching_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coaching_requests TO anon;
GRANT ALL ON TABLE public.coaching_requests TO authenticated;
GRANT ALL ON TABLE public.coaching_requests TO service_role;


--
-- Name: TABLE cohort_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cohort_members TO anon;
GRANT ALL ON TABLE public.cohort_members TO authenticated;
GRANT ALL ON TABLE public.cohort_members TO service_role;


--
-- Name: TABLE cohort_training_links; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cohort_training_links TO anon;
GRANT ALL ON TABLE public.cohort_training_links TO authenticated;
GRANT ALL ON TABLE public.cohort_training_links TO service_role;


--
-- Name: TABLE community_announcements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_announcements TO anon;
GRANT ALL ON TABLE public.community_announcements TO authenticated;
GRANT ALL ON TABLE public.community_announcements TO service_role;


--
-- Name: TABLE community_channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_channels TO anon;
GRANT ALL ON TABLE public.community_channels TO authenticated;
GRANT ALL ON TABLE public.community_channels TO service_role;


--
-- Name: TABLE community_comments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_comments TO anon;
GRANT ALL ON TABLE public.community_comments TO authenticated;
GRANT ALL ON TABLE public.community_comments TO service_role;


--
-- Name: TABLE community_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_flags TO anon;
GRANT ALL ON TABLE public.community_flags TO authenticated;
GRANT ALL ON TABLE public.community_flags TO service_role;


--
-- Name: TABLE community_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_notifications TO anon;
GRANT ALL ON TABLE public.community_notifications TO authenticated;
GRANT ALL ON TABLE public.community_notifications TO service_role;


--
-- Name: TABLE community_post_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_post_reads TO anon;
GRANT ALL ON TABLE public.community_post_reads TO authenticated;
GRANT ALL ON TABLE public.community_post_reads TO service_role;


--
-- Name: TABLE community_posts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_posts TO anon;
GRANT ALL ON TABLE public.community_posts TO authenticated;
GRANT ALL ON TABLE public.community_posts TO service_role;


--
-- Name: TABLE community_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_reactions TO anon;
GRANT ALL ON TABLE public.community_reactions TO authenticated;
GRANT ALL ON TABLE public.community_reactions TO service_role;


--
-- Name: TABLE community_resources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_resources TO anon;
GRANT ALL ON TABLE public.community_resources TO authenticated;
GRANT ALL ON TABLE public.community_resources TO service_role;


--
-- Name: TABLE community_space_invites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_invites TO anon;
GRANT ALL ON TABLE public.community_space_invites TO authenticated;
GRANT ALL ON TABLE public.community_space_invites TO service_role;


--
-- Name: TABLE community_space_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_members TO anon;
GRANT ALL ON TABLE public.community_space_members TO authenticated;
GRANT ALL ON TABLE public.community_space_members TO service_role;


--
-- Name: TABLE community_space_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_roles TO anon;
GRANT ALL ON TABLE public.community_space_roles TO authenticated;
GRANT ALL ON TABLE public.community_space_roles TO service_role;


--
-- Name: TABLE community_space_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_sources TO anon;
GRANT ALL ON TABLE public.community_space_sources TO authenticated;
GRANT ALL ON TABLE public.community_space_sources TO service_role;


--
-- Name: TABLE community_space_suspensions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_suspensions TO anon;
GRANT ALL ON TABLE public.community_space_suspensions TO authenticated;
GRANT ALL ON TABLE public.community_space_suspensions TO service_role;


--
-- Name: TABLE community_space_tiers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_tiers TO anon;
GRANT ALL ON TABLE public.community_space_tiers TO authenticated;
GRANT ALL ON TABLE public.community_space_tiers TO service_role;


--
-- Name: TABLE community_space_training; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_space_training TO anon;
GRANT ALL ON TABLE public.community_space_training TO authenticated;
GRANT ALL ON TABLE public.community_space_training TO service_role;


--
-- Name: TABLE community_spaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.community_spaces TO anon;
GRANT ALL ON TABLE public.community_spaces TO authenticated;
GRANT ALL ON TABLE public.community_spaces TO service_role;


--
-- Name: TABLE container_contents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.container_contents TO anon;
GRANT ALL ON TABLE public.container_contents TO authenticated;
GRANT ALL ON TABLE public.container_contents TO service_role;


--
-- Name: TABLE content_entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_entitlements TO anon;
GRANT ALL ON TABLE public.content_entitlements TO authenticated;
GRANT ALL ON TABLE public.content_entitlements TO service_role;


--
-- Name: TABLE content_persistence; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_persistence TO anon;
GRANT ALL ON TABLE public.content_persistence TO authenticated;
GRANT ALL ON TABLE public.content_persistence TO service_role;


--
-- Name: TABLE content_prerequisites; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.content_prerequisites TO anon;
GRANT ALL ON TABLE public.content_prerequisites TO authenticated;
GRANT ALL ON TABLE public.content_prerequisites TO service_role;


--
-- Name: TABLE course_object_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.course_object_assignments TO anon;
GRANT ALL ON TABLE public.course_object_assignments TO authenticated;
GRANT ALL ON TABLE public.course_object_assignments TO service_role;


--
-- Name: TABLE credit_redemptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.credit_redemptions TO anon;
GRANT ALL ON TABLE public.credit_redemptions TO authenticated;
GRANT ALL ON TABLE public.credit_redemptions TO service_role;


--
-- Name: TABLE deletion_archive; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deletion_archive TO anon;
GRANT ALL ON TABLE public.deletion_archive TO authenticated;
GRANT ALL ON TABLE public.deletion_archive TO service_role;


--
-- Name: TABLE deletion_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.deletion_requests TO anon;
GRANT ALL ON TABLE public.deletion_requests TO authenticated;
GRANT ALL ON TABLE public.deletion_requests TO service_role;


--
-- Name: TABLE docusign_envelope_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.docusign_envelope_recipients TO anon;
GRANT ALL ON TABLE public.docusign_envelope_recipients TO authenticated;
GRANT ALL ON TABLE public.docusign_envelope_recipients TO service_role;


--
-- Name: TABLE docusign_envelopes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.docusign_envelopes TO anon;
GRANT ALL ON TABLE public.docusign_envelopes TO authenticated;
GRANT ALL ON TABLE public.docusign_envelopes TO service_role;


--
-- Name: TABLE email_campaign_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_campaign_queue TO anon;
GRANT ALL ON TABLE public.email_campaign_queue TO authenticated;
GRANT ALL ON TABLE public.email_campaign_queue TO service_role;


--
-- Name: TABLE email_campaign_sends; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_campaign_sends TO anon;
GRANT ALL ON TABLE public.email_campaign_sends TO authenticated;
GRANT ALL ON TABLE public.email_campaign_sends TO service_role;


--
-- Name: TABLE email_campaigns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_campaigns TO anon;
GRANT ALL ON TABLE public.email_campaigns TO authenticated;
GRANT ALL ON TABLE public.email_campaigns TO service_role;


--
-- Name: TABLE email_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_templates TO anon;
GRANT ALL ON TABLE public.email_templates TO authenticated;
GRANT ALL ON TABLE public.email_templates TO service_role;


--
-- Name: TABLE ethnicity_options; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ethnicity_options TO anon;
GRANT ALL ON TABLE public.ethnicity_options TO authenticated;
GRANT ALL ON TABLE public.ethnicity_options TO service_role;


--
-- Name: TABLE event_companies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_companies TO anon;
GRANT ALL ON TABLE public.event_companies TO authenticated;
GRANT ALL ON TABLE public.event_companies TO service_role;


--
-- Name: TABLE event_manager_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_manager_assignments TO anon;
GRANT ALL ON TABLE public.event_manager_assignments TO authenticated;
GRANT ALL ON TABLE public.event_manager_assignments TO service_role;


--
-- Name: TABLE event_participations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_participations TO anon;
GRANT ALL ON TABLE public.event_participations TO authenticated;
GRANT ALL ON TABLE public.event_participations TO service_role;


--
-- Name: TABLE event_refunds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_refunds TO anon;
GRANT ALL ON TABLE public.event_refunds TO authenticated;
GRANT ALL ON TABLE public.event_refunds TO service_role;


--
-- Name: TABLE event_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_settings TO anon;
GRANT ALL ON TABLE public.event_settings TO authenticated;
GRANT ALL ON TABLE public.event_settings TO service_role;


--
-- Name: TABLE event_store_offerings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.event_store_offerings TO anon;
GRANT ALL ON TABLE public.event_store_offerings TO authenticated;
GRANT ALL ON TABLE public.event_store_offerings TO service_role;


--
-- Name: TABLE group_join_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.group_join_tokens TO anon;
GRANT ALL ON TABLE public.group_join_tokens TO authenticated;
GRANT ALL ON TABLE public.group_join_tokens TO service_role;


--
-- Name: TABLE host_availability; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.host_availability TO anon;
GRANT ALL ON TABLE public.host_availability TO authenticated;
GRANT ALL ON TABLE public.host_availability TO service_role;


--
-- Name: TABLE lead_capture_failures; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.lead_capture_failures TO anon;
GRANT ALL ON TABLE public.lead_capture_failures TO authenticated;
GRANT ALL ON TABLE public.lead_capture_failures TO service_role;


--
-- Name: TABLE member_activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_activity_log TO anon;
GRANT ALL ON TABLE public.member_activity_log TO authenticated;
GRANT ALL ON TABLE public.member_activity_log TO service_role;


--
-- Name: TABLE member_addresses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_addresses TO anon;
GRANT ALL ON TABLE public.member_addresses TO authenticated;
GRANT ALL ON TABLE public.member_addresses TO service_role;


--
-- Name: TABLE member_allergies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_allergies TO anon;
GRANT ALL ON TABLE public.member_allergies TO authenticated;
GRANT ALL ON TABLE public.member_allergies TO service_role;


--
-- Name: TABLE member_background_checks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_background_checks TO anon;
GRANT ALL ON TABLE public.member_background_checks TO authenticated;
GRANT ALL ON TABLE public.member_background_checks TO service_role;


--
-- Name: TABLE member_directory_prefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_directory_prefs TO anon;
GRANT ALL ON TABLE public.member_directory_prefs TO authenticated;
GRANT ALL ON TABLE public.member_directory_prefs TO service_role;


--
-- Name: TABLE member_ethnicities; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_ethnicities TO anon;
GRANT ALL ON TABLE public.member_ethnicities TO authenticated;
GRANT ALL ON TABLE public.member_ethnicities TO service_role;


--
-- Name: TABLE member_group_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_group_members TO anon;
GRANT ALL ON TABLE public.member_group_members TO authenticated;
GRANT ALL ON TABLE public.member_group_members TO service_role;


--
-- Name: TABLE member_groups; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_groups TO anon;
GRANT ALL ON TABLE public.member_groups TO authenticated;
GRANT ALL ON TABLE public.member_groups TO service_role;


--
-- Name: TABLE member_memberships; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_memberships TO anon;
GRANT ALL ON TABLE public.member_memberships TO authenticated;
GRANT ALL ON TABLE public.member_memberships TO service_role;


--
-- Name: TABLE member_notification_prefs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_notification_prefs TO anon;
GRANT ALL ON TABLE public.member_notification_prefs TO authenticated;
GRANT ALL ON TABLE public.member_notification_prefs TO service_role;


--
-- Name: TABLE member_schools; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_schools TO anon;
GRANT ALL ON TABLE public.member_schools TO authenticated;
GRANT ALL ON TABLE public.member_schools TO service_role;


--
-- Name: TABLE member_teacher_licenses; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.member_teacher_licenses TO anon;
GRANT ALL ON TABLE public.member_teacher_licenses TO authenticated;
GRANT ALL ON TABLE public.member_teacher_licenses TO service_role;


--
-- Name: SEQUENCE participants_membership_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.participants_membership_id_seq TO anon;
GRANT ALL ON SEQUENCE public.participants_membership_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.participants_membership_id_seq TO service_role;


--
-- Name: TABLE members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.members TO anon;
GRANT ALL ON TABLE public.members TO authenticated;
GRANT ALL ON TABLE public.members TO service_role;


--
-- Name: TABLE membership_tiers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.membership_tiers TO anon;
GRANT ALL ON TABLE public.membership_tiers TO authenticated;
GRANT ALL ON TABLE public.membership_tiers TO service_role;


--
-- Name: TABLE mentoring_cohorts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.mentoring_cohorts TO anon;
GRANT ALL ON TABLE public.mentoring_cohorts TO authenticated;
GRANT ALL ON TABLE public.mentoring_cohorts TO service_role;


--
-- Name: TABLE merch_batches; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.merch_batches TO anon;
GRANT ALL ON TABLE public.merch_batches TO authenticated;
GRANT ALL ON TABLE public.merch_batches TO service_role;


--
-- Name: TABLE object_type_relations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.object_type_relations TO anon;
GRANT ALL ON TABLE public.object_type_relations TO authenticated;
GRANT ALL ON TABLE public.object_type_relations TO service_role;


--
-- Name: TABLE object_type_singleton_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.object_type_singleton_roles TO anon;
GRANT ALL ON TABLE public.object_type_singleton_roles TO authenticated;
GRANT ALL ON TABLE public.object_type_singleton_roles TO service_role;


--
-- Name: TABLE participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.participants TO anon;
GRANT ALL ON TABLE public.participants TO authenticated;
GRANT ALL ON TABLE public.participants TO service_role;


--
-- Name: TABLE platform_pricing; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.platform_pricing TO anon;
GRANT ALL ON TABLE public.platform_pricing TO authenticated;
GRANT ALL ON TABLE public.platform_pricing TO service_role;


--
-- Name: TABLE refund_policies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.refund_policies TO anon;
GRANT ALL ON TABLE public.refund_policies TO authenticated;
GRANT ALL ON TABLE public.refund_policies TO service_role;


--
-- Name: TABLE registrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.registrations TO anon;
GRANT ALL ON TABLE public.registrations TO authenticated;
GRANT ALL ON TABLE public.registrations TO service_role;


--
-- Name: TABLE schools; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.schools TO anon;
GRANT ALL ON TABLE public.schools TO authenticated;
GRANT ALL ON TABLE public.schools TO service_role;


--
-- Name: TABLE sent_reminders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sent_reminders TO anon;
GRANT ALL ON TABLE public.sent_reminders TO authenticated;
GRANT ALL ON TABLE public.sent_reminders TO service_role;


--
-- Name: TABLE session_action_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.session_action_templates TO anon;
GRANT ALL ON TABLE public.session_action_templates TO authenticated;
GRANT ALL ON TABLE public.session_action_templates TO service_role;


--
-- Name: TABLE session_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.session_actions TO anon;
GRANT ALL ON TABLE public.session_actions TO authenticated;
GRANT ALL ON TABLE public.session_actions TO service_role;


--
-- Name: TABLE session_hosts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.session_hosts TO anon;
GRANT ALL ON TABLE public.session_hosts TO authenticated;
GRANT ALL ON TABLE public.session_hosts TO service_role;


--
-- Name: TABLE session_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.session_participants TO anon;
GRANT ALL ON TABLE public.session_participants TO authenticated;
GRANT ALL ON TABLE public.session_participants TO service_role;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;


--
-- Name: TABLE sheet_watch_channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sheet_watch_channels TO anon;
GRANT ALL ON TABLE public.sheet_watch_channels TO authenticated;
GRANT ALL ON TABLE public.sheet_watch_channels TO service_role;


--
-- Name: TABLE staff_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.staff_roles TO anon;
GRANT ALL ON TABLE public.staff_roles TO authenticated;
GRANT ALL ON TABLE public.staff_roles TO service_role;


--
-- Name: TABLE store_event_discounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_event_discounts TO anon;
GRANT ALL ON TABLE public.store_event_discounts TO authenticated;
GRANT ALL ON TABLE public.store_event_discounts TO service_role;


--
-- Name: TABLE store_order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_order_items TO anon;
GRANT ALL ON TABLE public.store_order_items TO authenticated;
GRANT ALL ON TABLE public.store_order_items TO service_role;


--
-- Name: TABLE store_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_orders TO anon;
GRANT ALL ON TABLE public.store_orders TO authenticated;
GRANT ALL ON TABLE public.store_orders TO service_role;


--
-- Name: TABLE store_products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_products TO anon;
GRANT ALL ON TABLE public.store_products TO authenticated;
GRANT ALL ON TABLE public.store_products TO service_role;


--
-- Name: TABLE store_returns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_returns TO anon;
GRANT ALL ON TABLE public.store_returns TO authenticated;
GRANT ALL ON TABLE public.store_returns TO service_role;


--
-- Name: TABLE store_tier_discounts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_tier_discounts TO anon;
GRANT ALL ON TABLE public.store_tier_discounts TO authenticated;
GRANT ALL ON TABLE public.store_tier_discounts TO service_role;


--
-- Name: TABLE store_variants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.store_variants TO anon;
GRANT ALL ON TABLE public.store_variants TO authenticated;
GRANT ALL ON TABLE public.store_variants TO service_role;


--
-- Name: TABLE stripe_webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.stripe_webhook_events TO anon;
GRANT ALL ON TABLE public.stripe_webhook_events TO authenticated;
GRANT ALL ON TABLE public.stripe_webhook_events TO service_role;


--
-- Name: TABLE tier_grant_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tier_grant_rules TO anon;
GRANT ALL ON TABLE public.tier_grant_rules TO authenticated;
GRANT ALL ON TABLE public.tier_grant_rules TO service_role;


--
-- Name: TABLE training_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_assignments TO anon;
GRANT ALL ON TABLE public.training_assignments TO authenticated;
GRANT ALL ON TABLE public.training_assignments TO service_role;


--
-- Name: TABLE training_certificates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_certificates TO anon;
GRANT ALL ON TABLE public.training_certificates TO authenticated;
GRANT ALL ON TABLE public.training_certificates TO service_role;


--
-- Name: TABLE training_enrollments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_enrollments TO anon;
GRANT ALL ON TABLE public.training_enrollments TO authenticated;
GRANT ALL ON TABLE public.training_enrollments TO service_role;


--
-- Name: TABLE training_item_resources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_item_resources TO anon;
GRANT ALL ON TABLE public.training_item_resources TO authenticated;
GRANT ALL ON TABLE public.training_item_resources TO service_role;


--
-- Name: TABLE training_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_items TO anon;
GRANT ALL ON TABLE public.training_items TO authenticated;
GRANT ALL ON TABLE public.training_items TO service_role;


--
-- Name: TABLE training_modules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_modules TO anon;
GRANT ALL ON TABLE public.training_modules TO authenticated;
GRANT ALL ON TABLE public.training_modules TO service_role;


--
-- Name: TABLE training_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_progress TO anon;
GRANT ALL ON TABLE public.training_progress TO authenticated;
GRANT ALL ON TABLE public.training_progress TO service_role;


--
-- Name: TABLE training_sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.training_sections TO anon;
GRANT ALL ON TABLE public.training_sections TO authenticated;
GRANT ALL ON TABLE public.training_sections TO service_role;


--
-- Name: TABLE video_watermark_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.video_watermark_jobs TO anon;
GRANT ALL ON TABLE public.video_watermark_jobs TO authenticated;
GRANT ALL ON TABLE public.video_watermark_jobs TO service_role;


--
-- Name: TABLE volunteer_event_interest; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.volunteer_event_interest TO anon;
GRANT ALL ON TABLE public.volunteer_event_interest TO authenticated;
GRANT ALL ON TABLE public.volunteer_event_interest TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: entitlements; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA entitlements GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: entitlements; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA entitlements GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict XwGn1zVO1hXSn7NADH84dp55IsiUPHjInhYDKWi7075NuvWdhYKKIgUCdZKEf3x

