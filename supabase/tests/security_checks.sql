-- Database security checks (deep review DB-N3; multi-tenancy plan S0-1, S0-3).
-- READ-ONLY: a single SELECT, safe to run on dev or prod — paste into the
-- Supabase SQL editor, or the Supabase MCP execute_sql. The Production
-- migration Action (.github/workflows/prod-migrate.yml) runs it inside every
-- apply and rolls the apply back if it returns any row.
--
-- PASS = zero rows. Each row is one finding: (finding, object, detail).
--
--   definer_public_execute: a SECURITY DEFINER function in a public-facing
--     schema that a public role can still EXECUTE (S0-1):
--       • anon may execute NO definer function at all;
--       • authenticated may execute only the RLS helpers named below, which
--         authenticated SELECT policies call (they fail closed without the
--         grant).
--     Keep the allow-list in step with FROZEN_RLS_HELPERS and the `rls-helper`
--     annotations in scripts/check-migration-security.mjs, and with its pgTAP
--     twin supabase/tests/database/security.test.sql (run by CI's `db` job).
--
--   search_path_mutable: a function in public or entitlements with no
--     search_path of its own (Security Advisor function_search_path_mutable;
--     S0-3). It resolves unqualified names through the caller's search_path.
--     Fix: ALTER FUNCTION … SET search_path = '' (with a schema-qualified body).
--
--   rls_no_policy: a table in public or entitlements with RLS on, no policy,
--     and no explicit-deny comment (Security Advisor rls_enabled_no_policy;
--     S0-3). Fix: the narrowest policy the code actually needs or, when only
--     service_role reads it, COMMENT ON TABLE … IS
--     'RLS on, no policy: service_role only (S0-3)' (a description may follow
--     the marker).
--   The pgTAP twin of both S0-3 checks is
--   supabase/tests/database/s0_search_path_rls.test.sql.
--
-- The two S0-3 checks are ARMED by migration 20261114030711_s0_rls_policies:
-- they report only once at least one table carries the explicit-deny marker.
-- Unarmed, a database without the S0-3 migrations (production until the owner
-- applies them) would return rows here, and the Production migration Action
-- would roll back every apply, the two S0-3 migrations included, since it
-- applies one file at a time. Apply 20261114030704_s0_pin_search_path first,
-- then 20261114030711_s0_rls_policies: the second apply arms both checks and
-- must pass them. CI's database has both migrations, so the pgTAP twin asserts
-- the checks are armed there and also runs them unconditionally.
WITH s0_armed AS (
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public', 'entitlements')
      AND starts_with(obj_description(c.oid, 'pg_class'),
                      'RLS on, no policy: service_role only (S0-3)')
  ) AS armed
)
SELECT 'definer_public_execute' AS finding,
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS object,
       'anon_exec=' || has_function_privilege('anon', p.oid, 'EXECUTE')
         || ' authenticated_exec=' || has_function_privilege('authenticated', p.oid, 'EXECUTE') AS detail
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef
  AND n.nspname IN ('public', 'entitlements')
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR (
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname NOT IN (
        'can_read_space',            -- community post/comment RLS (migration 118/132)
        'can_read_chat_channel',     -- chat_messages RLS
        'survey_current_member_id',  -- survey self-read RLS
        'space_unread_counts'        -- S0-9 open: service-role only in the app; revoke from authenticated next
      )
    )
  )
UNION ALL
SELECT 'search_path_mutable',
       n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'no search_path set on the function'
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN s0_armed
WHERE s0_armed.armed
  AND n.nspname IN ('public', 'entitlements')
  AND p.prokind IN ('f', 'p')
  AND NOT EXISTS (
    SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) AS cfg
    WHERE starts_with(cfg, 'search_path=')
  )
  -- A function an extension owns is the extension's to fix, not ours.
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
  )
UNION ALL
SELECT 'rls_no_policy',
       n.nspname || '.' || c.relname,
       'RLS on, no policy and no explicit-deny comment'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN s0_armed
WHERE s0_armed.armed
  AND n.nspname IN ('public', 'entitlements')
  AND c.relkind IN ('r', 'p')
  AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid)
  AND NOT coalesce(starts_with(obj_description(c.oid, 'pg_class'),
                               'RLS on, no policy: service_role only (S0-3)'), false)
ORDER BY 1, 2;
