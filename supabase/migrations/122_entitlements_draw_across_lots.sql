-- 122_entitlements_draw_across_lots.sql
-- Fix F-25 (mentoring buy-more non-functional): fn_book_from_allocation required a
-- SINGLE lot with quantity_remaining >= the cohort's planned_sessions. Purchased
-- top-ups (webhook 'mentoring_topup' → fn_grant_purchased) always create a SEPARATE
-- lot, so a member whose balance is split across lots (e.g. 2 left on the tier grant
-- + 4 purchased = 6 shown in the UI) could never register for a 6-session cohort —
-- the draw raised 'No included allocation available' even though the summed balance
-- sufficed. Bought sessions were paid but unusable.
--
-- Change: draw the needed quantity ACROSS lots, FIFO (soonest-expiring first, then
-- oldest), exactly like the UI sums the balance. Coaching draws 1 per booking so a
-- single lot always suffices there — behaviour is unchanged for coaching and for any
-- single-lot mentoring draw.
--
-- bookings.consumed_entitlement_id keeps pointing at the FIRST lot drawn from.
-- fn_cancel_cohort (migration 114) restores the full planned_sessions into that lot,
-- so the member's total balance is preserved on cancellation (attribution may shift
-- between lots; net quantity is identical).

create or replace function entitlements.fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid default null)
  returns uuid language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
end $function$;
