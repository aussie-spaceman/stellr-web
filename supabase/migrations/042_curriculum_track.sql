-- Migration 042: DC-derived ongoing curriculum track (access-model Phase 6).
--
-- The ongoing "high-school MBA" curriculum is membership-tier-gated and
-- persistent — the opposite of campaign-bound training. It reuses the existing
-- training_modules surface; this just adds a material_kind value so the Academy
-- catalogue can filter ongoing curriculum from competition/event material, and
-- gate it via the entitlement matrix (membership-tier subject).

ALTER TABLE public.training_modules DROP CONSTRAINT IF EXISTS training_modules_material_kind_check;
ALTER TABLE public.training_modules
  ADD CONSTRAINT training_modules_material_kind_check
  CHECK (material_kind IN ('general', 'event', 'campaign', 'cte', 'curriculum'));
