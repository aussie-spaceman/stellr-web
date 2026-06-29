-- 106_entitlements_draw_n_per_cohort.sql
-- Entitlements cutover · Phase 2.
--
-- (A) Reconcile the booking engine with PER-SESSION accounting (David 2026-06-26): the ledger
--     counts mentoring in SESSIONS (cohort_access = N sessions) but offerings are cohorts, so
--     enrolling in an N-session mentoring cohort must draw N allocations, not 1. Coaching (and
--     everything else) still draws 1. Requires quantity_remaining >= the cohort's planned_sessions.
--
-- (B) Finish blocker 1 (migration 103 dropped entitlements.{entitlements,bookings}.participant_id
--     so the ledger keys off member_id — but three functions still referenced participant_id and
--     would error on first call). Remove those references. p_participant params are kept for
--     signature compatibility but ignored.

-- Booking from an included allocation — draws N for cohorts, keyed off member_id.
create or replace function entitlements.fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid default null)
  returns uuid language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
declare o entitlements.offerings%rowtype; v_kind entitlements.entitlement_kind; v_needed int := 1; lot entitlements.entitlements%rowtype; b_id uuid;
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
  select * into lot from entitlements.entitlements
   where member_id = p_member and kind = v_kind and status = 'active'
     and quantity_remaining >= v_needed and valid_from <= now() and (expires_at is null or expires_at > now())
     and ( scope_type = 'generic'
        or (scope_type = 'specific_offering' and offering_id = p_offering)
        or (scope_type = 'offering_type' and offering_type = o.type) )
   order by expires_at nulls last, created_at
   for update skip locked limit 1;
  if lot.id is null then raise exception 'No included allocation available'; end if;
  if o.type = 'mentoring_cohort' and o.capacity is not null then
    if o.seats_taken >= o.capacity then raise exception 'Cohort full'; end if;
    update entitlements.offerings set seats_taken = seats_taken + 1,
           status = case when seats_taken + 1 >= capacity then 'full' else status end
     where id = p_offering;
  end if;
  update entitlements.entitlements
     set quantity_remaining = quantity_remaining - v_needed,
         status = case when quantity_remaining - v_needed <= 0 then 'consumed' else status end
   where id = lot.id;
  insert into entitlements.bookings(member_id, offering_id, consumed_entitlement_id, amount_charged_cents, status)
  values (p_member, p_offering, lot.id, 0, 'reserved')
  returning id into b_id;
  return b_id;
end $function$;

-- Paid booking — keyed off member_id (participant_id removed).
create or replace function entitlements.fn_confirm_paid_booking(p_member uuid, p_offering uuid, p_stripe_payment text, p_amount_charged_cents integer, p_credit_applied_cents integer, p_participant uuid default null)
  returns uuid language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
end $function$;

-- Booking guard — keep the cross-member check; the participant earmark is obsolete.
create or replace function entitlements.trg_booking_guard()
  returns trigger language plpgsql as $function$
declare ent entitlements.entitlements%rowtype;
begin
  if new.consumed_entitlement_id is not null then
    select * into ent from entitlements.entitlements where id = new.consumed_entitlement_id;
    if ent.member_id <> new.member_id then
      raise exception 'Entitlement % does not belong to this member (no cross-member use)', ent.id;
    end if;
  end if;
  return new;
end $function$;
