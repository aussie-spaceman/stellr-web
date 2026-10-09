-- deep review ES-2: the birth-year gate on a minor's signing link counted a
-- wrong answer with a read-then-write (load failed_token_attempts, compare,
-- write +1). Parallel guesses all read the same pre-count and each wrote 1, so
-- the five-try lock never engaged and a stranger could fire one request per
-- plausible birth year at once. Count each attempt atomically instead: a
-- single conditional UPDATE under the row lock that increments and returns the
-- new count, or NULL once the cap is spent. The caller charges a slot *before*
-- comparing the year, so a guess beyond the fifth is never even evaluated.

-- Returns the attempt's new failed-check count, or NULL when the cap is already
-- spent (no row updated). Mirrors esign_claim_email's claim-one pattern.
CREATE OR REPLACE FUNCTION public.esign_note_failed_check(p_id uuid, p_max int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  UPDATE public.agreement_recipients
     SET failed_token_attempts = failed_token_attempts + 1
   WHERE id = p_id AND failed_token_attempts < p_max
  RETURNING failed_token_attempts INTO v;
  RETURN v;
END $$;

-- Only the service role (the signing routes) may charge an attempt.
REVOKE EXECUTE ON FUNCTION public.esign_note_failed_check(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.esign_note_failed_check(uuid, int) TO service_role;
