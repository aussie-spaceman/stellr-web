-- 110_entitlements_grant_purchased.sql
-- Entitlements cutover · Phase 3 (slice 1) — migrate the extra-session PURCHASE
-- grants from session_credits to the entitlements ledger.
--
-- The topup/extra-session Stripe webhooks (extra_session, coaching_topup,
-- mentoring_topup) inserted session_credits rows. After the Phase-2 consumption
-- flip that's wrong: coaching reads the ledger for included sessions, and mentoring
-- no longer reads session_credits at all (so a mentoring topup was orphaned — paid,
-- never usable). Route purchases into the ledger as PURCHASED lots instead — same
-- coaching_session / cohort_access balance the booking engine already draws from,
-- so a bought extra is simply more balance.
--
-- One refundable lot of `quantity`, scope_type='offering_type' (so it books the
-- right product), idempotent on the Stripe session id (webhook retries are safe).
-- Expiry defaults to fn_purchase_expiry() — the same window à-la-carte bookings use.

create or replace function entitlements.fn_grant_purchased(
  p_member uuid,
  p_kind entitlements.entitlement_kind,
  p_quantity integer,
  p_stripe_session text,
  p_expires_at timestamptz default null)
  returns integer language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
end $function$;
