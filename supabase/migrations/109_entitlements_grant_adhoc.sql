-- 109_entitlements_grant_adhoc.sql
-- Entitlements cutover · Phase 4 — grant-rule split (credit-granting half).
--
-- tier_grant_rules with grant_kind='credits' hand out N wallet credits via
-- lib/credits.grantCredits → session_credits. After the Phase-2 consumption flip
-- the wallet is DEAD (consumeOldestCredit/getCredits/syncAllowance have zero
-- callers; mentoring + coaching now read the entitlements ledger), so those rule
-- grants land where nothing reads them. This routes rule-based credit grants into
-- the ledger instead, mirroring the tier-grant lot shape (fn_grant_member_benefits,
-- migration 091): one lot, scope_type='offering_type', so a cohort_access grant
-- books mentoring and a coaching_session grant books coaching.
--
-- Idempotent on (member, kind, source='admin', source_ref) — the caller passes a
-- stable grant key (rule:seed:member) so re-fired rules never double-grant.
-- Mapping (David, per-session): credit type 'mentoring' → cohort_access,
-- 'workshop' → coaching_session. Rule grants do not expire (port of the old
-- wallet's roll-forever behaviour); pass an expiry only if a rule needs one.

create or replace function entitlements.fn_grant_adhoc(
  p_member uuid,
  p_kind entitlements.entitlement_kind,
  p_quantity integer,
  p_source_ref text,
  p_expires_at timestamptz default null)
  returns integer language plpgsql security definer set search_path to 'entitlements', 'public' as $function$
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
end $function$;
