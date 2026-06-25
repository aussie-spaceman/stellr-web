-- =====================================================================
-- 088_entitlements_foundation.sql
-- Member entitlements / pricing / credits — Option 3 (catalog + unified
-- entitlement ledger + pricing engine). FOUNDATION ONLY: additive, safe,
-- non-destructive. No existing table is altered or dropped here.
--
-- Adapted from the locked handover schema to THIS codebase:
--   * Identity keys off public.members(id) (70 FKs already depend on it);
--     the handover's accounts/participants tables are NOT created.
--   * The new entitlements.tiers becomes the canonical tier table, BACKFILLED
--     from all 15 live membership_tiers rows (preserving Stripe price ids).
--     FK repointing + dropping membership_tiers is a LATER migration done in
--     lockstep with the app rewire and verified on a prod clone.
--   * Allocations seeded from REAL session_entitlements (coaching 6 / 365d for
--     the 5 paid tiers). NO discount rows / cohort quantities are seeded — the
--     live config has none and the handover's 25/30% + "Scholar 5" values are
--     illustrative, pending David's real policy.
--   * RLS matches the rest of the app: enabled, service-role only, NO member
--     JWT policies (all reads go through supabaseServer() + Clerk userId).
--   * Money is integer cents throughout.
--
-- Locked BEHAVIOURAL rules from HANDOVER §2.2 are preserved verbatim in the
-- functions (refundable purchased / non-refundable granted, no transfer,
-- hard-reserve cohort seats, no-show forfeit, cohort-cancel credit/restore,
-- purchased never expires, granted expires on revert).
-- =====================================================================

create schema if not exists entitlements;

-- ---------------------------------------------------------------------
-- ENUMS (namespaced to avoid collisions with public enums)
-- ---------------------------------------------------------------------
create type entitlements.offering_type     as enum ('coaching_session','mentoring_cohort','call_series','training_content');
create type entitlements.entitlement_kind  as enum ('coaching_session','cohort_access','call_series','training_access','generic');
create type entitlements.scope_type        as enum ('specific_offering','offering_type','generic');
create type entitlements.grant_source      as enum ('purchased','competition_auto','award_auto','volunteer_unlock','admin','tier_grant');
create type entitlements.entitlement_status as enum ('active','consumed','expired','refunded');
create type entitlements.booking_status    as enum ('reserved','attended','no_show','cancelled');
create type entitlements.credit_reason     as enum ('cohort_cancellation','refund','goodwill','adjustment','redemption');

-- ---------------------------------------------------------------------
-- CANONICAL TIERS (backfilled from live membership_tiers below)
-- member_group is nullable text: the 15 live tiers do not all map to the
-- handover's school/college/educator triad.
-- ---------------------------------------------------------------------
create table entitlements.tiers (
  code                    text primary key,            -- derived from name
  membership_tier_id      uuid unique,                 -- transition link -> public.membership_tiers(id)
  name                    text not null,
  member_group            text,
  annual_price_cents      integer,                     -- null until pricing is loaded
  store_discount_pct      numeric(5,2) not null default 0,
  stripe_price_id         text,
  stripe_price_id_monthly text,
  is_free                 boolean not null default false
);

-- allocation rows (quantity of a kind per period) and discount rows.
-- validity_days carried from session_entitlements so granted lots can expire
-- on their own clock (live coaching allowance = 365 days).
create table entitlements.tier_benefits (
  id           uuid primary key default gen_random_uuid(),
  tier_code    text not null references entitlements.tiers(code) on delete cascade,
  kind         entitlements.entitlement_kind,
  quantity     integer,
  period       text not null default 'one_off'
                 check (period in ('one_off','monthly','quarterly','per_term')),
  validity_days integer,
  discount_pct numeric(5,2),
  applies_to   entitlements.offering_type,
  check ( (kind is not null and quantity is not null)
       or (discount_pct is not null) )
);
create index on entitlements.tier_benefits(tier_code);

-- ---------------------------------------------------------------------
-- OFFERINGS + PRICES (new; capacity/seats_taken is the authoritative seat count)
-- offerings can optionally link back to an existing mentoring_cohorts row
-- during the transition.
-- ---------------------------------------------------------------------
create table entitlements.offerings (
  id           uuid primary key default gen_random_uuid(),
  type         entitlements.offering_type not null,
  cohort_id    uuid,                                   -- -> public.mentoring_cohorts(id) (transition)
  provider_member_id uuid references public.members(id),
  title        text not null,
  segment      text,
  duration_min integer,
  capacity     integer,
  seats_taken  integer not null default 0,
  starts_at    timestamptz,
  ends_at      timestamptz,
  status       text not null default 'open'
                 check (status in ('open','full','cancelled','completed')),
  created_at   timestamptz not null default now(),
  check (capacity is null or seats_taken <= capacity)
);

create table entitlements.prices (
  id            uuid primary key default gen_random_uuid(),
  offering_id   uuid references entitlements.offerings(id) on delete cascade,
  offering_type entitlements.offering_type,
  segment       text,
  amount_cents  integer not null,
  currency      text not null default 'USD',
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  check (offering_id is not null or offering_type is not null)
);
create index on entitlements.prices(offering_id);
create index on entitlements.prices(offering_type, segment);

-- ---------------------------------------------------------------------
-- ENTITLEMENT LEDGER ("lots") — member-keyed. Optional participant earmark
-- references the EXISTING public.participants (event registrants) for the
-- per-student earmark case.
-- ---------------------------------------------------------------------
create table entitlements.entitlements (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid not null references public.members(id) on delete cascade,
  participant_id     uuid references public.participants(id),
  kind               entitlements.entitlement_kind not null,
  scope_type         entitlements.scope_type not null,
  offering_id        uuid references entitlements.offerings(id),
  offering_type      entitlements.offering_type,
  quantity_total     integer not null check (quantity_total > 0),
  quantity_remaining integer not null check (quantity_remaining >= 0),
  source             entitlements.grant_source not null,
  source_ref         text,
  refundable         boolean not null default false,
  status             entitlements.entitlement_status not null default 'active',
  valid_from         timestamptz not null default now(),
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  check (quantity_remaining <= quantity_total)
);
create index on entitlements.entitlements(member_id, kind) where status = 'active';
create index on entitlements.entitlements(offering_id);

create table entitlements.bookings (
  id                      uuid primary key default gen_random_uuid(),
  member_id               uuid not null references public.members(id),
  participant_id          uuid references public.participants(id),
  offering_id             uuid not null references entitlements.offerings(id),
  consumed_entitlement_id uuid references entitlements.entitlements(id),
  amount_charged_cents    integer not null default 0,
  credit_applied_cents    integer not null default 0,
  stripe_payment_id       text,
  status                  entitlements.booking_status not null default 'reserved',
  created_at              timestamptz not null default now()
);
create index on entitlements.bookings(offering_id) where status = 'reserved';
create index on entitlements.bookings(member_id);

create table entitlements.account_credit_ledger (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid not null references public.members(id) on delete cascade,
  amount_cents       integer not null,
  reason             entitlements.credit_reason not null,
  related_booking_id uuid references entitlements.bookings(id),
  note               text,
  created_at         timestamptz not null default now()
);
create index on entitlements.account_credit_ledger(member_id);

-- idempotency / bookkeeping
create table entitlements.processed_events (
  event_id    text primary key,
  type        text,
  received_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- NO-TRANSFER GUARD: a booking's member must own the consumed entitlement,
-- and match the participant earmark if one is set.
-- ---------------------------------------------------------------------
create or replace function entitlements.trg_booking_guard() returns trigger
language plpgsql as $$
declare ent entitlements.entitlements%rowtype;
begin
  if new.consumed_entitlement_id is not null then
    select * into ent from entitlements.entitlements where id = new.consumed_entitlement_id;
    if ent.member_id <> new.member_id then
      raise exception 'Entitlement % does not belong to this member (no cross-member use)', ent.id;
    end if;
    if ent.participant_id is not null and ent.participant_id is distinct from new.participant_id then
      raise exception 'Entitlement % is earmarked to another participant (no transfer)', ent.id;
    end if;
  end if;
  return new;
end $$;

create trigger booking_guard before insert or update on entitlements.bookings
  for each row execute function entitlements.trg_booking_guard();

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------
create or replace function entitlements.fn_allocation_balance(
  p_member uuid, p_kind entitlements.entitlement_kind, p_offering uuid default null,
  p_offering_type entitlements.offering_type default null
) returns integer language sql stable as $$
  select coalesce(sum(quantity_remaining),0)::int
  from entitlements.entitlements
  where member_id = p_member and kind = p_kind and status = 'active'
    and valid_from <= now() and (expires_at is null or expires_at > now())
    and ( scope_type = 'generic'
       or (scope_type = 'specific_offering' and offering_id = p_offering)
       or (scope_type = 'offering_type'     and offering_type = p_offering_type) );
$$;

create or replace function entitlements.fn_credit_balance(p_member uuid)
returns integer language sql stable as $$
  select coalesce(sum(amount_cents),0)::int
  from entitlements.account_credit_ledger where member_id = p_member;
$$;

-- Active tier code for a member, read from the EXISTING member_memberships +
-- the transition link on entitlements.tiers.
create or replace function entitlements.fn_active_tier(p_member uuid)
returns text language sql stable as $$
  select t.code
  from public.member_memberships mm
  join entitlements.tiers t on t.membership_tier_id = mm.tier_id
  where mm.member_id = p_member
    and (mm.expires_at is null or mm.expires_at >= current_date)
  order by mm.started_at desc limit 1;
$$;

create or replace function entitlements.fn_purchase_expiry()
returns timestamptz language sql stable as $$ select null::timestamptz; $$;

create or replace function entitlements.fn_base_price_cents(p_offering uuid)
returns integer language plpgsql stable as $$
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

create or replace function entitlements.fn_tier_discount_pct(p_member uuid, p_type entitlements.offering_type)
returns numeric language sql stable as $$
  select coalesce(max(tb.discount_pct),0)
  from entitlements.tier_benefits tb
  where tb.tier_code = entitlements.fn_active_tier(p_member)
    and tb.discount_pct is not null
    and (tb.applies_to is null or tb.applies_to = p_type);
$$;

-- ---------------------------------------------------------------------
-- QUOTE (read-only)
-- ---------------------------------------------------------------------
create or replace function entitlements.fn_quote(p_member uuid, p_offering uuid)
returns table (
  included_available boolean, base_cents integer, discount_pct numeric,
  net_cents integer, credit_available integer, payable_cents integer
) language plpgsql stable as $$
declare o entitlements.offerings%rowtype; v_base int; v_disc numeric; v_net int; v_credit int; v_kind entitlements.entitlement_kind;
begin
  select * into o from entitlements.offerings where id = p_offering;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;
  included_available := entitlements.fn_allocation_balance(p_member, v_kind, p_offering, o.type) > 0;
  if included_available then
    return query select true, 0, 0::numeric, 0, entitlements.fn_credit_balance(p_member), 0; return;
  end if;
  v_base   := coalesce(entitlements.fn_base_price_cents(p_offering), 0);
  v_disc   := entitlements.fn_tier_discount_pct(p_member, o.type);
  v_net    := round(v_base * (1 - v_disc/100.0))::int;
  v_credit := entitlements.fn_credit_balance(p_member);
  return query select false, v_base, v_disc, v_net, v_credit, greatest(v_net - v_credit, 0);
end $$;

-- ---------------------------------------------------------------------
-- BOOK FROM INCLUDED ALLOCATION (free path)
-- ---------------------------------------------------------------------
create or replace function entitlements.fn_book_from_allocation(p_member uuid, p_offering uuid, p_participant uuid default null)
returns uuid language plpgsql security definer set search_path = entitlements, public as $$
declare o entitlements.offerings%rowtype; v_kind entitlements.entitlement_kind; lot entitlements.entitlements%rowtype; b_id uuid;
begin
  select * into o from entitlements.offerings where id = p_offering for update;
  if o.status <> 'open' then raise exception 'Offering % not open', p_offering; end if;
  v_kind := case o.type
              when 'coaching_session' then 'coaching_session'::entitlements.entitlement_kind
              when 'mentoring_cohort' then 'cohort_access'::entitlements.entitlement_kind
              when 'call_series'      then 'call_series'::entitlements.entitlement_kind
              when 'training_content' then 'training_access'::entitlements.entitlement_kind
            end;
  select * into lot from entitlements.entitlements
   where member_id = p_member and kind = v_kind and status = 'active'
     and quantity_remaining > 0 and valid_from <= now() and (expires_at is null or expires_at > now())
     and ( scope_type = 'generic'
        or (scope_type = 'specific_offering' and offering_id = p_offering)
        or (scope_type = 'offering_type' and offering_type = o.type) )
     and (participant_id is null or participant_id = p_participant)
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
     set quantity_remaining = quantity_remaining - 1,
         status = case when quantity_remaining - 1 = 0 then 'consumed' else status end
   where id = lot.id;

  insert into entitlements.bookings(member_id, participant_id, offering_id, consumed_entitlement_id, amount_charged_cents, status)
  values (p_member, p_participant, p_offering, lot.id, 0, 'reserved')
  returning id into b_id;
  return b_id;
end $$;

-- ---------------------------------------------------------------------
-- CONFIRM PAID BOOKING (cash path; called after Stripe payment succeeds)
-- ---------------------------------------------------------------------
create or replace function entitlements.fn_confirm_paid_booking(
  p_member uuid, p_offering uuid, p_stripe_payment text,
  p_amount_charged_cents integer, p_credit_applied_cents integer, p_participant uuid default null
) returns uuid language plpgsql security definer set search_path = entitlements, public as $$
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
  insert into entitlements.entitlements(member_id, participant_id, kind, scope_type, offering_id,
                           quantity_total, quantity_remaining, source, source_ref, refundable, status, expires_at)
  values (p_member, p_participant, v_kind, 'specific_offering', p_offering,
          1, 0, 'purchased', p_stripe_payment, true, 'consumed', entitlements.fn_purchase_expiry())
  returning id into ent_id;
  if p_credit_applied_cents > 0 then
    insert into entitlements.account_credit_ledger(member_id, amount_cents, reason)
    values (p_member, -p_credit_applied_cents, 'redemption');
  end if;
  insert into entitlements.bookings(member_id, participant_id, offering_id, consumed_entitlement_id,
                       amount_charged_cents, credit_applied_cents, stripe_payment_id, status)
  values (p_member, p_participant, p_offering, ent_id, p_amount_charged_cents, p_credit_applied_cents, p_stripe_payment, 'reserved')
  returning id into b_id;
  return b_id;
end $$;

create or replace function entitlements.fn_mark_no_show(p_booking uuid)
returns void language plpgsql security definer set search_path = entitlements, public as $$
begin
  update entitlements.bookings set status = 'no_show' where id = p_booking and status = 'reserved';
end $$;

create or replace function entitlements.fn_cancel_cohort(p_offering uuid)
returns void language plpgsql security definer set search_path = entitlements, public as $$
declare b entitlements.bookings%rowtype;
begin
  for b in select * from entitlements.bookings where offering_id = p_offering and status = 'reserved'
  loop
    if b.amount_charged_cents > 0 or b.credit_applied_cents > 0 then
      insert into entitlements.account_credit_ledger(member_id, amount_cents, reason, related_booking_id, note)
      values (b.member_id, b.amount_charged_cents + b.credit_applied_cents,
              'cohort_cancellation', b.id, 'Auto credit on cohort cancellation');
    elsif b.consumed_entitlement_id is not null then
      update entitlements.entitlements
         set quantity_remaining = quantity_remaining + 1, status = 'active',
             expires_at = greatest(coalesce(expires_at, now()), now() + interval '90 days')
       where id = b.consumed_entitlement_id;
    end if;
    update entitlements.bookings set status = 'cancelled' where id = b.id;
  end loop;
  update entitlements.offerings set seats_taken = 0, status = 'cancelled' where id = p_offering;
end $$;

create or replace function entitlements.fn_refund_entitlement(p_entitlement uuid, p_mode text, p_amount_cents integer)
returns void language plpgsql security definer set search_path = entitlements, public as $$
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

create or replace function entitlements.fn_claim_event(p_event_id text, p_type text)
returns boolean language plpgsql security definer set search_path = entitlements, public as $$
declare v_new integer;
begin
  insert into entitlements.processed_events(event_id, type) values (p_event_id, p_type)
  on conflict (event_id) do nothing;
  get diagnostics v_new = row_count;
  return v_new = 1;
end $$;

-- ---------------------------------------------------------------------
-- RLS: service-role only (matches migration 049 convention). Enable RLS,
-- define NO member-facing policies => members cannot touch these via the
-- anon/authenticated key; all access is server-side via the service role.
-- ---------------------------------------------------------------------
alter table entitlements.tiers                 enable row level security;
alter table entitlements.tier_benefits         enable row level security;
alter table entitlements.offerings             enable row level security;
alter table entitlements.prices                enable row level security;
alter table entitlements.entitlements          enable row level security;
alter table entitlements.bookings              enable row level security;
alter table entitlements.account_credit_ledger enable row level security;
alter table entitlements.processed_events      enable row level security;

-- ---------------------------------------------------------------------
-- BACKFILL: canonical tiers from ALL live membership_tiers (15 rows),
-- preserving Stripe price ids and the is_free flag.
-- code = lower(name) with non-alphanumerics collapsed to underscore.
-- ---------------------------------------------------------------------
insert into entitlements.tiers (code, membership_tier_id, name, is_free, stripe_price_id, stripe_price_id_monthly)
select lower(regexp_replace(name, '[^A-Za-z0-9]+', '_', 'g')),
       id, name, is_free, stripe_price_id, stripe_price_id_monthly
from public.membership_tiers
on conflict (code) do update
  set membership_tier_id      = excluded.membership_tier_id,
      name                    = excluded.name,
      is_free                 = excluded.is_free,
      stripe_price_id         = excluded.stripe_price_id,
      stripe_price_id_monthly = excluded.stripe_price_id_monthly;

-- BACKFILL: coaching allocations from REAL session_entitlements
-- (the 5 paid tiers each get 6 coaching sessions, 365-day validity).
insert into entitlements.tier_benefits (tier_code, kind, quantity, period, validity_days)
select t.code, 'coaching_session'::entitlements.entitlement_kind, se.included_sessions, 'one_off', se.validity_days
from public.session_entitlements se
join entitlements.tiers t on t.membership_tier_id = se.tier_id
where se.session_type = 'coaching';

-- NOTE: no discount rows and no cohort_access quantity rows are seeded here.
-- Live config has neither; the handover's 25/30% discounts and per-period
-- cohort quantities are illustrative and await David's real policy before
-- being added in a follow-up migration.
