-- Migration 016: Add missing member enum values
-- The `members` table's enum types drifted from what the app actually uses.
-- Registration / portal code references these values, but the enums never had
-- them, so member upserts containing them failed (22P02) and silently dropped
-- the whole batch (see lib/member-enums.ts and app/api/register/*).
--
--   • event_role_type   — code checks `event_role === 'adult'` (TeamsTab adult vs
--                         student counts) and `=== 'school_student_manager'`
--                         (group-manager permissions), but neither existed.
--   • tshirt_size_type  — the registration form offers "3XL (or larger)", which
--                         had no enum value.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; run each
-- statement on its own (the Supabase SQL editor does this automatically).

ALTER TYPE public.event_role_type  ADD VALUE IF NOT EXISTS 'adult';
ALTER TYPE public.event_role_type  ADD VALUE IF NOT EXISTS 'school_student_manager';
ALTER TYPE public.tshirt_size_type ADD VALUE IF NOT EXISTS '3XL (or larger)';
