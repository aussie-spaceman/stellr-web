-- 108_entitlements_release_one_booking.sql
-- Entitlements cutover · Phase 2 — refund-on-cancel for coaching (per-session).
--
-- bookCoaching now draws 1 `coaching_session` from the ledger per session. The old
-- count-based model auto-refunded a cancelled/declined session (it only counted
-- scheduled/completed sessions), so the ledger model must explicitly release the
-- draw or cancelling a coaching session would silently burn an included allowance.
--
-- entitlements.bookings are NOT linked to the sessions row, and a coaching offering
-- is per coachee/coach container (many sessions → many bookings on one offering).
-- For the allowance COUNT, releasing any one reserved *included* booking on that
-- member's offering restores +1 — which is exactly the cancelled session's draw.
-- Paid bookings (amount/credit > 0) are left alone (paid extras were never auto-
-- refunded). Mirrors the restore arm of fn_cancel_cohort (migration 088).

create or replace function entitlements.fn_release_one_booking(p_member uuid, p_offering uuid)
  returns boolean language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
end $function$;
