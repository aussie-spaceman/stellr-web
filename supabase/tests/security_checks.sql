-- Function-privilege check (deep review DB-N3; multi-tenancy plan S0-1).
-- READ-ONLY: a single SELECT, safe to run on dev or prod — paste into the
-- Supabase SQL editor, or the Supabase MCP execute_sql.
--
-- PASS = zero rows. Each row returned is a SECURITY DEFINER function in a
-- public-facing schema that a public role can still EXECUTE:
--   • anon may execute NO definer function at all;
--   • authenticated may execute only the RLS helpers named below, which
--     authenticated SELECT policies call (they fail closed without the grant).
-- Keep the allow-list in step with FROZEN_RLS_HELPERS and the `rls-helper`
-- annotations in scripts/check-migration-security.mjs.
SELECT n.nspname AS schema,
       p.proname AS function,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec
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
ORDER BY 1, 2;
