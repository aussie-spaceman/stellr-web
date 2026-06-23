-- Migration 067: wire Trailblazer self-serve Stripe price (annual, $1,000/yr).
-- price_1TlXIuFHHVJXH5AbDQrwDYuj — recurring, USD 100000 cents, interval=year.
UPDATE public.membership_tiers
SET stripe_price_id = 'price_1TlXIuFHHVJXH5AbDQrwDYuj'
WHERE name = 'Trailblazer'
  AND stripe_price_id IS NULL;
