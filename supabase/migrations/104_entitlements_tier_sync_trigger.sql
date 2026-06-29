-- 104_entitlements_tier_sync_trigger.sql
-- Entitlements cutover · Phase 0 (finish). Makes entitlements.tiers self-maintain as a
-- projection of the authoritative membership_tiers, so it never drifts again (103 did the
-- one-time re-sync). On INSERT/UPDATE → upsert the projection row; on DELETE → remove it.

-- Stable projection link so the trigger can upsert by membership_tier_id.
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tiers_membership_tier_id_uniq' and conrelid = 'entitlements.tiers'::regclass
  ) then
    alter table entitlements.tiers add constraint tiers_membership_tier_id_uniq unique (membership_tier_id);
  end if;
end $$;

create or replace function entitlements.project_tier()
  returns trigger language plpgsql security definer set search_path = entitlements, public as $$
begin
  if tg_op = 'DELETE' then
    delete from entitlements.tiers where membership_tier_id = old.id;
    return old;
  end if;
  insert into entitlements.tiers
    (code, membership_tier_id, name, annual_price_cents, store_discount_pct, stripe_price_id, stripe_price_id_monthly, is_free)
  values (
    lower(regexp_replace(new.name, '[^A-Za-z0-9]+', '_', 'g')), new.id, new.name, new.annual_cost_cents,
    coalesce((select percent_off from public.store_tier_discounts d where d.tier_id = new.id and d.scope = 'all' limit 1), 0),
    new.stripe_price_id, new.stripe_price_id_monthly, new.is_free)
  on conflict (membership_tier_id) do update set
    code = excluded.code, name = excluded.name, annual_price_cents = excluded.annual_price_cents,
    store_discount_pct = excluded.store_discount_pct, stripe_price_id = excluded.stripe_price_id,
    stripe_price_id_monthly = excluded.stripe_price_id_monthly, is_free = excluded.is_free;
  return new;
end $$;

drop trigger if exists trg_project_tier on membership_tiers;
create trigger trg_project_tier
  after insert or update or delete on membership_tiers
  for each row execute function entitlements.project_tier();
