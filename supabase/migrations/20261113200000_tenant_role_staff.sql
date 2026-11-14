-- The Staff role (13 Nov 2026): between Event Manager and Admin, Stellr only.
--
-- 20261113120000 renamed the old tenant_role 'staff' (the admin_duties mirror)
-- to 'duty_holder', so the value is free. This adds it back with its new
-- meaning: a Stellr Staff membership, written by lib/authz/role-sync.ts when
-- lib/staff.ts activates a grant and the Clerk role 'staff' is set. A 'staff'
-- row on any tenant other than Stellr grants nothing (lib/authz/decide.ts).
--
-- ADD VALUE is safe inside the migration Action's transaction on Postgres 15;
-- the value is not used until the code that writes it ships.

ALTER TYPE public.tenant_role ADD VALUE IF NOT EXISTS 'staff' BEFORE 'event_manager';
