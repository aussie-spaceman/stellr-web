-- =====================================================================
-- 093_entitlements_cutover_backfill.sql   (CUTOVER — Stage 1 of N)
-- ADDITIVE + REVERSIBLE. Makes the entitlements ledger MIRROR live state:
--   (a) bridge active mentoring_cohorts -> entitlements.offerings (bookable)
--   (b) backfill available session_credits -> entitlement lots
--   (c) backfill remaining account_credits -> account_credit_ledger
-- No live table is modified or dropped here. The consumption rewire (making
-- the ledger the SOLE booking path + retiring session_credits) is later stages,
-- done in lockstep with the app and reviewed before going live.
--
-- DOCUMENTED MAPPING DECISIONS (flag for David):
--   * session_credits.session_type 'coaching' -> kind coaching_session;
--     'mentoring' -> cohort_access. 'workshop' is SKIPPED here (separate
--     coaching-container product; mapped in a later stage).
--   * Refundability: credits from source 'topup'/'purchase' backfill as
--     PURCHASED (refundable); 'allowance'/'grant' as TIER_GRANT (not
--     refundable) — matching the locked rule.
--   * Bridged cohorts get capacity = NULL (live cohorts are uncapped today),
--     so no hard-reserve until a capacity is set on the offering.
-- Idempotent: safe to run more than once.
-- =====================================================================

-- one offering per bridged cohort
create unique index if not exists uq_offerings_cohort on entitlements.offerings(cohort_id) where cohort_id is not null;

-- (a) Bridge mentoring_cohorts -> offerings. Returns offerings created.
create or replace function entitlements.fn_sync_cohort_offerings()
returns integer language plpgsql security definer set search_path = entitlements, public as $$
declare v_n integer;
begin
  with ins as (
    insert into entitlements.offerings (type, cohort_id, title, capacity, status)
    select 'mentoring_cohort'::entitlements.offering_type, c.id, c.name, null,
           case when c.is_active and c.archived_at is null then 'open' else 'completed' end
    from public.mentoring_cohorts c
    where not exists (select 1 from entitlements.offerings o where o.cohort_id = c.id)
    returning 1
  )
  select count(*)::int into v_n from ins;
  return v_n;
end $$;

-- (b)+(c) Backfill legacy credits + account credit into the ledger. Idempotent
-- via deterministic source_ref markers. Returns rows inserted (lots + ledger).
create or replace function entitlements.fn_backfill_legacy_credits()
returns integer language plpgsql security definer set search_path = entitlements, public as $$
declare r record; v_n integer := 0; v_kind entitlements.entitlement_kind; v_src text; v_ref text;
begin
  -- available session_credits grouped by member, type, and purchased-vs-granted
  for r in
    select sc.member_id,
           sc.session_type,
           case when sc.source in ('topup','purchase') then 'purchased' else 'tier_grant' end as grp,
           count(*)::int as qty
    from public.session_credits sc
    where sc.status = 'available' and sc.session_type in ('coaching','mentoring')
    group by 1,2,3
  loop
    v_kind := case r.session_type when 'coaching' then 'coaching_session'::entitlements.entitlement_kind
                                  when 'mentoring' then 'cohort_access'::entitlements.entitlement_kind end;
    v_src := r.grp;  -- 'purchased' | 'tier_grant'
    v_ref := 'backfill:credits:' || r.member_id::text || ':' || r.session_type || ':' || r.grp;
    if exists (select 1 from entitlements.entitlements where source_ref = v_ref) then continue; end if;
    insert into entitlements.entitlements(
      member_id, kind, scope_type, offering_type,
      quantity_total, quantity_remaining, source, source_ref, refundable, status, expires_at)
    values (
      r.member_id, v_kind, 'offering_type', entitlements.fn_kind_to_offering(v_kind),
      r.qty, r.qty, v_src::entitlements.grant_source, v_ref,
      (v_src = 'purchased'), 'active', null);   -- legacy credits roll over => no expiry
    v_n := v_n + 1;
  end loop;

  -- remaining account_credits -> account_credit_ledger (one ledger row per source)
  for r in
    select ac.id, ac.member_id, ac.remaining_cents
    from public.account_credits ac
    where ac.remaining_cents > 0 and ac.status = 'active'
  loop
    v_ref := 'backfill:account_credits:' || r.id::text;
    if exists (select 1 from entitlements.account_credit_ledger where note = v_ref) then continue; end if;
    insert into entitlements.account_credit_ledger(member_id, amount_cents, reason, note)
    values (r.member_id, r.remaining_cents, 'adjustment', v_ref);
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- Run the backfill once at migration time. Re-running the migration (or the
-- functions) is a no-op thanks to the idempotency guards above.
select entitlements.fn_sync_cohort_offerings();
select entitlements.fn_backfill_legacy_credits();
