-- 112_entitlements_cancel_cohort_restore_n.sql
-- (renumbered from 111 — a parallel session also created 111_membership_monthly_prices)
-- Entitlements cutover · Phase 3b — fix cohort-cancel refund to restore N.
--
-- fn_cancel_cohort (migration 088) restored quantity_remaining + 1 per allocation
-- booking. But migration 106 made a mentoring_cohort booking DRAW planned_sessions
-- (N), so cancelling an N-session cohort under-refunded (restored 1, not N). Mirror
-- fn_book_from_allocation's draw size: mentoring_cohort restores planned_sessions,
-- everything else (coaching_session) restores 1. Paid bookings still refund their
-- charge to account credit.
--
-- Now reachable from lib/entitlements.cancelCohortViaLedger (mentoring deleteCohort
-- + coaching deleteWorkshop), which replaced the session_credits-scanning refunds.

create or replace function entitlements.fn_cancel_cohort(p_offering uuid)
returns void language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
    if b.amount_charged_cents > 0 or b.credit_applied_cents > 0 then
      insert into entitlements.account_credit_ledger(member_id, amount_cents, reason, related_booking_id, note)
      values (b.member_id, b.amount_charged_cents + b.credit_applied_cents,
              'cohort_cancellation', b.id, 'Auto credit on cohort cancellation');
    elsif b.consumed_entitlement_id is not null then
      update entitlements.entitlements
         set quantity_remaining = quantity_remaining + v_restore, status = 'active',
             expires_at = greatest(coalesce(expires_at, now()), now() + interval '90 days')
       where id = b.consumed_entitlement_id;
    end if;
    update entitlements.bookings set status = 'cancelled' where id = b.id;
  end loop;
  update entitlements.offerings set seats_taken = 0, status = 'cancelled' where id = p_offering;
end $function$;
