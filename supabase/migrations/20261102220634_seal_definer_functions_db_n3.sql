-- Seal the SECURITY DEFINER functions left anon/authenticated-callable (deep
-- review DB-N3; multi-tenancy plan Stage 0, item S0-1).
--
-- 20261002180802_esign_native_engine, 20261002235036_post_event_survey and
-- 20261003002925_post_event_survey_member_link revoked EXECUTE `FROM PUBLIC`
-- only. On this project the default privileges ALSO grant EXECUTE to anon and
-- authenticated directly, so every function below stayed reachable through
-- /rest/v1/rpc with the public anon key (confirmed on prod 2 Nov 2026 with
-- has_function_privilege). Among them: survey_purge_person (deletes survey data
-- by email), esign_purge_audit (erases a consent form's audit trail),
-- esign_append_audit (forges one) and the two *_claim_email budget counters
-- (stalls consent mail). Every legitimate caller uses the service-role client.
--
-- Each revoke names PUBLIC, anon AND authenticated: neither half alone is enough
-- (see scripts/check-migration-security.mjs). service_role keeps its explicit
-- grants from the original migrations; they are restated so this file stands on
-- its own. Idempotent: REVOKE/GRANT of an absent/present privilege is a no-op.

-- RPCs the app calls with the service role -----------------------------------
REVOKE EXECUTE ON FUNCTION public.esign_append_audit(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esign_purge_audit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esign_claim_email(date, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.survey_redact_answer(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.survey_purge_person(uuid, uuid[], text[], text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.survey_claim_email(date, int) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.esign_append_audit(uuid, uuid, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_purge_audit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_claim_email(date, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.survey_submit_response(uuid, jsonb, boolean, text, boolean, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.survey_redact_answer(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.survey_purge_person(uuid, uuid[], text[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.survey_claim_email(date, int) TO service_role;

-- Trigger functions: /rpc cannot invoke a `RETURNS trigger` function, and a
-- trigger fires regardless of EXECUTE, so this changes no behaviour. Sealed so
-- no definer function is left callable by a public role.
REVOKE EXECUTE ON FUNCTION public.survey_responses_audit_delete() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.survey_follow_participant_member() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_ensure_tier_space() FROM PUBLIC, anon, authenticated;

-- RLS helper: the survey self-read policies call it as `authenticated`, so it
-- keeps that grant; anon has no use for it.
REVOKE EXECUTE ON FUNCTION public.survey_current_member_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.survey_current_member_id() TO authenticated, service_role;

-- The chain helpers are SECURITY INVOKER (anon would hit RLS), but they too were
-- revoked FROM PUBLIC only. Defence in depth: service role only.
REVOKE EXECUTE ON FUNCTION public.esign_verify_audit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esign_audit_heads() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.esign_verify_audit(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_audit_heads() TO service_role;
GRANT EXECUTE ON FUNCTION public.esign_audit_digest(text, uuid, uuid, text, timestamptz, text, text, jsonb) TO service_role;
