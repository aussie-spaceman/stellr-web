-- Migration 004: Stripe membership price IDs and subscription tracking

-- Add monthly price ID to membership_tiers (existing stripe_price_id = annual)
ALTER TABLE public.membership_tiers
  ADD COLUMN IF NOT EXISTS stripe_price_id_monthly text;

-- Track Stripe subscription + billing interval on member_memberships
ALTER TABLE public.member_memberships
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS billing_interval text check (billing_interval in ('monthly', 'annual'));

-- Track Stripe customer ID on members (reuse across purchases)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- Populate paid tier price IDs
-- Pathfinder ($60/yr)
UPDATE public.membership_tiers SET
  stripe_price_id         = 'price_1Tbl6XKUgSKucUJEADtOv3Ji',
  stripe_price_id_monthly = 'price_1Tbl6XKUgSKucUJEci97iMmZ'
WHERE name = 'Pathfinder';

-- Scholar ($120/yr)
UPDATE public.membership_tiers SET
  stripe_price_id         = 'price_1TdvgEKUgSKucUJElqqKnQpr',
  stripe_price_id_monthly = 'price_1Tf5E9KUgSKucUJENP7UIHCr'
WHERE name = 'Scholar';

-- Contributor ($250/yr)
UPDATE public.membership_tiers SET
  stripe_price_id = 'price_1Tf5FvKUgSKucUJEsIcBoQGl'
WHERE name = 'Contributor';

-- Counsellor ($500/yr)
UPDATE public.membership_tiers SET
  stripe_price_id = 'price_1Tf5GFKUgSKucUJE64EAUhmz'
WHERE name = 'Counsellor';

-- Luminary ($500/yr)
UPDATE public.membership_tiers SET
  stripe_price_id = 'price_1Tf5GUKUgSKucUJEJfOBSDGn'
WHERE name = 'Luminary';

-- Innovator ($200/yr)
UPDATE public.membership_tiers SET
  stripe_price_id = 'price_1Tf5GuKUgSKucUJECCVCMdol'
WHERE name = 'Innovator';
