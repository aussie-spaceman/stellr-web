-- =====================================================================
-- 089_entitlements_discounts_coupons.sql
-- Additive. Adds the single admin-editable discount layer (per-tier
-- discounts + time-bounded coupon codes) that drives the pricing engine,
-- plus free-mentoring ledger allocations. No existing table dropped.
--
-- Decisions (David, 25-Jun):
--   * ONE admin table (entitlements.discounts) is the source of truth for
--     discounts everywhere (public pages + app read it; nothing hardcoded).
--     Two kinds: 'tier' (by membership tier) and 'coupon' (a code, with an
--     active window + optional redemption cap).
--   * Free mentoring is modelled as LEDGER ALLOCATIONS (cohort_access rows
--     in tier_benefits), admin-editable quantity — NOT a per-cohort flag.
--   * No per-tier coaching/cohort discount is seeded (live has none); the
--     table is created empty for tiers and ready for admin entry.
-- Money is integer cents. Percent is numeric(5,2).
-- =====================================================================

-- ---------------------------------------------------------------------
-- DISCOUNTS — single source of truth (tier discounts + coupons)
-- ---------------------------------------------------------------------
create table entitlements.discounts (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('tier','coupon')),
  tier_code       text references entitlements.tiers(code) on delete cascade, -- required for 'tier'
  code            text,                                                        -- required for 'coupon'
  label           text,
  discount_type   text not null check (discount_type in ('percent','fixed')),
  percent         numeric(5,2),       -- when discount_type='percent'
  amount_cents    integer,            -- when discount_type='fixed'
  applies_to      entitlements.offering_type,  -- null = all offering types
  valid_from      timestamptz,        -- null = no lower bound
  valid_to        timestamptz,        -- null = no upper bound
  max_redemptions integer,            -- coupons only; null = unlimited
  times_redeemed  integer not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- shape guards
  check (kind = 'coupon' or tier_code is not null),         -- tier rows need a tier
  check (kind = 'tier'   or code is not null),              -- coupon rows need a code
  check (discount_type = 'fixed'   or percent is not null),
  check (discount_type = 'percent' or amount_cents is not null)
);
-- one live coupon per code
create unique index uq_discounts_coupon_code on entitlements.discounts(lower(code)) where kind = 'coupon';
create index idx_discounts_tier on entitlements.discounts(tier_code) where kind = 'tier';

create table entitlements.coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  discount_id  uuid not null references entitlements.discounts(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  booking_id   uuid references entitlements.bookings(id),
  amount_cents integer not null,
  created_at   timestamptz not null default now()
);
create index on entitlements.coupon_redemptions(discount_id);
create index on entitlements.coupon_redemptions(member_id);

alter table entitlements.discounts          enable row level security; -- service-role only
alter table entitlements.coupon_redemptions enable row level security;

-- keep updated_at fresh
create or replace function entitlements.trg_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger touch_discounts before update on entitlements.discounts
  for each row execute function entitlements.trg_touch_updated_at();

-- ---------------------------------------------------------------------
-- PRICING ENGINE: tier discount now reads the discounts table.
-- ---------------------------------------------------------------------
create or replace function entitlements.fn_tier_discount_pct(p_member uuid, p_type entitlements.offering_type)
returns numeric language sql stable as $$
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

-- Validate a coupon for an offering type; returns the usable row or none.
create or replace function entitlements.fn_validate_coupon(p_code text, p_type entitlements.offering_type)
returns entitlements.discounts language sql stable as $$
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

-- QUOTE: included? else base -> tier discount -> coupon -> credit.
-- p_coupon is optional; an invalid/expired/exhausted code is simply ignored
-- (coupon_applied=false) rather than raising, so the UI can show "code not valid".
drop function if exists entitlements.fn_quote(uuid, uuid);
create or replace function entitlements.fn_quote(p_member uuid, p_offering uuid, p_coupon text default null)
returns table (
  included_available    boolean,
  base_cents            integer,
  tier_discount_pct     numeric,
  after_tier_cents      integer,
  coupon_code           text,
  coupon_applied        boolean,
  coupon_discount_cents integer,
  net_cents             integer,     -- after tier discount + coupon, before credit
  credit_available      integer,
  payable_cents         integer
) language plpgsql stable as $$
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

-- Record a coupon redemption (called from the paid-booking path when a coupon
-- was used). Increments times_redeemed atomically.
create or replace function entitlements.fn_redeem_coupon(p_code text, p_member uuid, p_booking uuid, p_amount_cents integer)
returns void language plpgsql security definer set search_path = entitlements, public as $$
declare d entitlements.discounts;
begin
  select * into d from entitlements.discounts
   where kind='coupon' and lower(code)=lower(p_code) and is_active for update;
  if d.id is null then return; end if;
  insert into entitlements.coupon_redemptions(discount_id, member_id, booking_id, amount_cents)
  values (d.id, p_member, p_booking, p_amount_cents);
  update entitlements.discounts set times_redeemed = times_redeemed + 1 where id = d.id;
end $$;

-- ---------------------------------------------------------------------
-- FREE MENTORING -> ledger allocations.
-- Seed a cohort_access allocation for the tiers that include free mentoring
-- (Contributor, Innovator, Pathfinder, Scholar, Trailblazer).
-- QUANTITY/period below is a PLACEHOLDER (1 per quarter) pending David's real
-- numbers; it is admin-editable in entitlements.tier_benefits.
-- ---------------------------------------------------------------------
insert into entitlements.tier_benefits (tier_code, kind, quantity, period)
select code, 'cohort_access'::entitlements.entitlement_kind, 1, 'quarterly'
from entitlements.tiers
where code in ('contributor','innovator','pathfinder','scholar','trailblazer')
  and not exists (
    select 1 from entitlements.tier_benefits tb
    where tb.tier_code = entitlements.tiers.code and tb.kind = 'cohort_access');
