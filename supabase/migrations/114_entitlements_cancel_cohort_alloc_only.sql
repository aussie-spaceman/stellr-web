-- 114_entitlements_cancel_cohort_alloc_only.sql
-- Entitlements cutover · deferral #3 (David: route cohort refunds to the GENERAL
-- account-credit system) — make fn_cancel_cohort restore allocations ONLY.
--
-- Phase 3b's fn_cancel_cohort refunded PAID bookings into entitlements.account_credit_
-- ledger (spendable only at entitlements/checkout). Decision: cohort/workshop paid
-- refunds should land in public.account_credits (the general system — redeemable at
-- membership checkout, shown in billing) so a member keeps ONE spendable, visible
-- balance, matching every other refund. The PAID refund now happens in TS
-- (lib/entitlements.cancelCohortViaLedger inserts account_credits); this function
-- keeps only the entitlements concern: restore drawn allocations (+N for mentoring,
-- +1 else) and cancel the bookings + offering. The paid arm (account_credit_ledger
-- insert) is removed so the two paths don't double-refund.

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
end $function$;
