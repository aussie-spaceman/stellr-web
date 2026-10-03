-- Survey DB checks (handover §10 "DB tests"). Run against DEV only:
--   paste into the Supabase SQL editor, or the Supabase MCP execute_sql.
-- It creates throwaway rows, asserts, and ends by raising
-- 'SURVEY_DB_CHECKS_PASSED' so that every row it wrote is rolled back.
-- Any other error message is a failure.
DO $$
DECLARE
  v_def uuid;
  v_dist uuid;
  v_inv uuid;
  v_resp uuid;
  v_member_a uuid;
  v_member_b uuid;
  v_clerk_a text := 'user_surveytest_a_' || substr(md5(random()::text), 1, 8);
  v_clerk_b text := 'user_surveytest_b_' || substr(md5(random()::text), 1, 8);
  v_ok boolean;
  v_n int;
BEGIN
  -- Fixtures ----------------------------------------------------------------
  SELECT id INTO v_member_a FROM public.members ORDER BY created_at LIMIT 1;
  SELECT id INTO v_member_b FROM public.members WHERE id <> v_member_a ORDER BY created_at LIMIT 1;
  IF v_member_a IS NULL OR v_member_b IS NULL THEN RAISE EXCEPTION 'need two members on dev'; END IF;
  -- Point two members at fake Clerk ids for the RLS check (rolled back).
  UPDATE public.members SET clerk_user_id = v_clerk_a WHERE id = v_member_a;
  UPDATE public.members SET clerk_user_id = v_clerk_b WHERE id = v_member_b;

  INSERT INTO public.survey_definitions (key, version, title, definition, definition_sha256, status, published_at)
  VALUES ('dbcheck', 1, 'DB check', '{"a":1}', 'x', 'published', now()) RETURNING id INTO v_def;

  -- 1. Published definition is frozen --------------------------------------
  v_ok := false;
  BEGIN
    UPDATE public.survey_definitions SET definition = '{"a":2}' WHERE id = v_def;
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 1: published definition was editable'; END IF;

  -- 2. closes_at = opens_at + 30 days, recomputed on change ------------------
  INSERT INTO public.survey_distributions (definition_id, event_slug, event_date, event_time_zone, opens_at, closes_at)
  VALUES (v_def, 'dbcheck-event', '2026-10-10', 'America/Denver', '2026-10-10 06:00+00', '2000-01-01')
  RETURNING id INTO v_dist;
  SELECT count(*) INTO v_n FROM public.survey_distributions
   WHERE id = v_dist AND closes_at = '2026-11-09 06:00+00';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 2a: closes_at not opens_at + 30 days'; END IF;
  UPDATE public.survey_distributions SET opens_at = '2026-10-08 06:00+00', closes_at = '2030-01-01' WHERE id = v_dist;
  SELECT count(*) INTO v_n FROM public.survey_distributions
   WHERE id = v_dist AND closes_at = '2026-11-07 06:00+00';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 2b: closes_at not recomputed'; END IF;

  INSERT INTO public.survey_invitations (distribution_id, recipient_key, member_id, respondent_role, email, token_hash)
  VALUES (v_dist, 'member:' || v_member_a, v_member_a, 'student', 'dbcheck@example.com', md5(random()::text))
  RETURNING id INTO v_inv;
  INSERT INTO public.survey_responses (invitation_id, definition_id, distribution_id, event_slug, event_year,
                                       member_id, respondent_role, draft_answers, started_at)
  VALUES (v_inv, v_def, v_dist, 'dbcheck-event', 2026, v_member_a, 'student', '{"nps":9}', now())
  RETURNING id INTO v_resp;

  -- 3. Answers cannot be written into an unsubmitted draft ------------------
  v_ok := false;
  BEGIN
    INSERT INTO public.survey_answers (response_id, question_key, value_numeric) VALUES (v_resp, 'nps', 9);
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 3: answer inserted into an unsubmitted response'; END IF;

  -- Submit (one transaction, via the definer function).
  PERFORM public.survey_submit_response(v_resp,
    '[{"question_key":"nps","value_numeric":9,"value_text":"9"},{"question_key":"highlight","value_text":"Rockets"}]'::jsonb,
    true, NULL, false, true, 'email');
  SELECT count(*) INTO v_n FROM public.survey_invitations WHERE id = v_inv AND status = 'submitted';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 4: invitation not marked submitted'; END IF;

  -- 5. A submitted response's answers and consents cannot change ------------
  v_ok := false;
  BEGIN
    UPDATE public.survey_responses SET draft_answers = '{"nps":0}' WHERE id = v_resp;
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5a: submitted draft_answers editable'; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.survey_responses SET followup_consent = false WHERE id = v_resp;
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5b: submitted consent editable'; END IF;
  v_ok := false;
  BEGIN
    PERFORM public.survey_submit_response(v_resp, '[]'::jsonb, true, NULL, false, true, 'email');
  EXCEPTION WHEN OTHERS THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5c: response submitted twice'; END IF;
  -- Permitted after submit: member backfill and quote withdrawal.
  UPDATE public.survey_responses SET member_id = v_member_a, quote_withdrawn_at = now(), quote_withdrawn_by = 'dbcheck' WHERE id = v_resp;
  v_ok := false;
  BEGIN
    UPDATE public.survey_responses SET quote_withdrawn_at = NULL WHERE id = v_resp;
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5d: withdrawn quote reinstated'; END IF;

  -- 6. Answers: no UPDATE, no DELETE ------------------------------------------
  v_ok := false;
  BEGIN
    UPDATE public.survey_answers SET value_numeric = 0 WHERE response_id = v_resp AND question_key = 'nps';
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 6a: answer updated'; END IF;
  v_ok := false;
  BEGIN
    DELETE FROM public.survey_answers WHERE response_id = v_resp;
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 6b: answer deleted'; END IF;

  -- 7. Redaction works through the definer function and is audited ----------
  IF NOT public.survey_redact_answer(v_resp, 'highlight', 'dbcheck', 'test') THEN
    RAISE EXCEPTION 'FAIL 7a: redaction found nothing';
  END IF;
  SELECT count(*) INTO v_n FROM public.survey_answers WHERE response_id = v_resp AND question_key = 'highlight' AND value_text = '[redacted]';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 7b: answer not redacted'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_log WHERE table_name = 'survey_answers' AND record_id = v_resp;
  IF v_n < 1 THEN RAISE EXCEPTION 'FAIL 7c: redaction not audited'; END IF;
  -- The flag does not leak past the function.
  v_ok := false;
  BEGIN
    UPDATE public.survey_answers SET value_numeric = 1 WHERE response_id = v_resp AND question_key = 'nps';
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 7d: redaction flag leaked'; END IF;

  -- 8. RLS: a member reads their own submitted response, not another's -------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_clerk_a, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.survey_responses WHERE id = v_resp;
  IF v_n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 8a: owner cannot read own response'; END IF;
  SELECT count(*) INTO v_n FROM public.survey_answers WHERE response_id = v_resp;
  IF v_n <> 2 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 8b: owner cannot read own answers (%)', v_n; END IF;
  v_ok := false;
  BEGIN
    UPDATE public.survey_responses SET current_page = 'x' WHERE id = v_resp;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  IF NOT v_ok THEN RESET ROLE; RAISE EXCEPTION 'FAIL 8c: member could write a response'; END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_clerk_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.survey_responses WHERE id = v_resp;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 8d: another member read the response'; END IF;
  SELECT count(*) INTO v_n FROM public.survey_answers WHERE response_id = v_resp;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 8e: another member read the answers'; END IF;
  RESET ROLE;

  SET LOCAL ROLE anon;
  v_ok := false;
  BEGIN
    SELECT count(*) INTO v_n FROM public.survey_responses;
  EXCEPTION WHEN insufficient_privilege THEN v_ok := true; END;
  RESET ROLE;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 8f: anon can query responses'; END IF;

  -- 9. Purge removes everything for the person, audited, without content ----
  PERFORM public.survey_purge_person(v_member_a, ARRAY[]::uuid[], ARRAY['dbcheck@example.com'], 'dbcheck');
  SELECT count(*) INTO v_n FROM public.survey_responses WHERE id = v_resp;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 9a: response survived purge'; END IF;
  SELECT count(*) INTO v_n FROM public.survey_answers WHERE response_id = v_resp;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 9b: answers survived purge'; END IF;
  SELECT count(*) INTO v_n FROM public.survey_invitations WHERE id = v_inv;
  IF v_n <> 0 THEN RAISE EXCEPTION 'FAIL 9c: invitation survived purge'; END IF;
  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE table_name = 'survey_responses' AND record_id = v_resp AND action = 'DELETE'
     AND NOT (old_data ? 'draft_answers');
  IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 9d: deletion not audited content-free'; END IF;

  -- 10. Access log is append-only ---------------------------------------------
  INSERT INTO public.survey_access_log (actor, action) VALUES ('dbcheck', 'view');
  v_ok := false;
  BEGIN
    DELETE FROM public.survey_access_log WHERE actor = 'dbcheck';
  EXCEPTION WHEN raise_exception THEN v_ok := true; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 10: access log deletable'; END IF;

  -- 11. Linking a participant to an account re-associates their survey rows --
  DECLARE
    v_part uuid;
    v_reg uuid;
    v_inv2 uuid;
  BEGIN
    INSERT INTO public.registrations (event_slug, event_title, type, status) VALUES ('dbcheck-event', 'DB check', 'individual', 'confirmed') RETURNING id INTO v_reg;
    INSERT INTO public.participants (registration_id, first_name, last_name, email, phone, date_of_birth, gender, t_shirt_size, school_name, age_bracket, event_role)
    VALUES (v_reg, 'Db', 'Check', 'dbcheck2@example.com', '0', '2010-01-01', '', 'M', '', 'high_school', 'participant') RETURNING id INTO v_part;
    INSERT INTO public.survey_invitations (distribution_id, recipient_key, participant_id, respondent_role, email, token_hash)
    VALUES (v_dist, 'email:dbcheck2@example.com', v_part, 'student', 'dbcheck2@example.com', md5(random()::text)) RETURNING id INTO v_inv2;
    INSERT INTO public.survey_responses (invitation_id, definition_id, distribution_id, participant_id, respondent_role)
    VALUES (v_inv2, v_def, v_dist, v_part, 'student');
    UPDATE public.participants SET member_id = v_member_b WHERE id = v_part;
    SELECT count(*) INTO v_n FROM public.survey_responses WHERE participant_id = v_part AND member_id = v_member_b;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 11a: response not re-associated'; END IF;
    SELECT count(*) INTO v_n FROM public.survey_invitations WHERE id = v_inv2 AND member_id = v_member_b;
    IF v_n <> 1 THEN RAISE EXCEPTION 'FAIL 11b: invitation not re-associated'; END IF;
  END;

  RAISE EXCEPTION 'SURVEY_DB_CHECKS_PASSED';
END $$;
