-- Idempotency store for Stripe webhook deliveries.
--
-- Stripe delivers at-least-once: any handler error (or a network blip on our 200)
-- causes redelivery, which without a guard re-runs every branch — re-activating a
-- membership (expiring the just-created one + inserting a duplicate row and grants)
-- and re-sending confirmation emails. We record each processed event.id and skip
-- events we've already fully handled.
--
-- Server-only writes (service role); RLS on with no policy = deny-all to
-- anon/authenticated, matching the other server-owned tables.
create table if not exists public.stripe_webhook_events (
  id          text primary key,             -- Stripe event id (evt_...)
  type        text not null,
  received_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

-- Optional housekeeping: this table grows unbounded; a periodic delete of rows
-- older than ~30 days is safe (Stripe does not retry beyond 3 days).
