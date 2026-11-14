-- S0-3 (Security Advisor "function_search_path_mutable"): pin search_path on
-- every function in public and entitlements that had none.
--
-- docs/SECURITY-HOTFIX-C-2026-11-02.md left these for S0-3. A function with no
-- search_path of its own resolves unqualified names through the CALLER's
-- search_path, so a caller who can put an object earlier on that path can
-- change what the function does.
--
-- The list, derived from the schema CI builds (supabase/baseline.sql plus
-- every timestamped migration): pg_proc in public or entitlements, prokind
-- 'f', proconfig without a search_path entry, not owned by an extension. All
-- ten come from two migrations:
--
--   20261002180802_esign_native_engine.sql
--     public.esign_templates_freeze()                       trigger, plpgsql
--     public.esign_audit_digest(text, uuid, uuid, text,
--       timestamptz, text, text, jsonb)                     sql, IMMUTABLE
--     public.esign_audit_events_guard()                     trigger, plpgsql
--     public.esign_audit_heads()                            sql, STABLE
--   20261002235036_post_event_survey.sql
--     public.survey_definitions_freeze()                    trigger, plpgsql
--     public.survey_distributions_close_date()              trigger, plpgsql
--     public.survey_responses_freeze()                      trigger, plpgsql
--     public.survey_answers_immutable()                     trigger, plpgsql
--     public.survey_answers_insert_guard()                  trigger, plpgsql
--     public.survey_access_log_append_only()                trigger, plpgsql
--
-- Why '' (empty) is safe for all ten, without changing what any of them does:
-- every table and non-catalog function in their bodies is already
-- schema-qualified (public.esign_audit_events, public.survey_responses,
-- extensions.digest). Everything else they use is in pg_catalog (now,
-- coalesce, concat_ws, encode, to_char, current_setting, set_config, the
-- built-in types and operators), and pg_catalog is always searched, even with
-- an empty search_path. Record fields (NEW.x, OLD.x) resolve through the
-- trigger's table, not the search path. The bodies are not re-created here.
--
-- One side effect, not a behaviour change: Postgres does not inline a SQL
-- function that carries a SET clause. esign_audit_digest is called row by row
-- from the plpgsql functions esign_append_audit and esign_verify_audit, and
-- esign_audit_heads is called through the Data API (rpc), so neither was being
-- inlined into a larger query.
--
-- ALTER FUNCTION keeps the owner, grants and SECURITY setting as they are.
-- Idempotent: setting the same value again is a no-op.
--
-- NOT APPLIED to any database by the PR that adds it. Proven only by CI's
-- `db` job (pgTAP: supabase/tests/database/s0_search_path_rls.test.sql).

ALTER FUNCTION public.esign_templates_freeze() SET search_path = '';
ALTER FUNCTION public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb) SET search_path = '';
ALTER FUNCTION public.esign_audit_events_guard() SET search_path = '';
ALTER FUNCTION public.esign_audit_heads() SET search_path = '';

ALTER FUNCTION public.survey_definitions_freeze() SET search_path = '';
ALTER FUNCTION public.survey_distributions_close_date() SET search_path = '';
ALTER FUNCTION public.survey_responses_freeze() SET search_path = '';
ALTER FUNCTION public.survey_answers_immutable() SET search_path = '';
ALTER FUNCTION public.survey_answers_insert_guard() SET search_path = '';
ALTER FUNCTION public.survey_access_log_append_only() SET search_path = '';
