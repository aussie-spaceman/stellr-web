-- rate_limit (S5 B4): a fixed-window counter shared across serverless instances,
-- for lib/rate-limit-store.ts.
--
-- Inert when applied: nothing calls these functions while RATE_LIMIT_STORE is
-- memory, its default, and no route uses the async limiter yet.
--
-- UNLOGGED on purpose. These are short-lived counters written on hot paths, so
-- they skip the WAL and physical replicas never see them. A database crash empties
-- the table, which resets the current windows and nothing else. A logical pg_dump
-- still includes the rows unless told otherwise, so the nightly backup holds these
-- HMACs while the store is in use.
--
-- key_hash is an HMAC-SHA256 made by the app under RATE_LIMIT_KEY_SECRET. Raw
-- keys hold IP addresses and sometimes names, and never reach this table.

CREATE UNLOGGED TABLE IF NOT EXISTS public.rate_limit_hits (
  key_hash       bytea       NOT NULL CHECK (octet_length(key_hash) = 32),
  window_seconds int         NOT NULL CHECK (window_seconds > 0),
  window_start   timestamptz NOT NULL,
  hits           int         NOT NULL CHECK (hits >= 0),
  PRIMARY KEY (key_hash, window_seconds)
);

COMMENT ON TABLE public.rate_limit_hits IS
  'Fixed-window rate limit counters keyed by an HMAC of the limiter key. Written only through rate_limit_take(); expired windows are removed by rate_limit_gc().';

-- The functions are the only way to write. service_role may read, to compare
-- shadow counts with the in-memory decisions.
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.rate_limit_hits TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role reads rate_limit_hits"
    ON public.rate_limit_hits FOR SELECT TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Count one request against every window given, and return the first denial in
-- the order the caller listed them, or (true, 0) when all allow it.
--
-- Each upsert takes the row's lock until the transaction ends, so concurrent
-- takes on one key run one after another and each reads the count the last one
-- left. Rows are locked in sorted order so that two multi-window takes cannot
-- deadlock. A denied request still counts in its other windows, as it does in
-- the in-memory limiter.
--
-- lock_timeout matches the 300 ms the app waits for an answer. Past that the app
-- has moved on, so a queued take gives up and frees its connection. The app reads
-- that error as "the store could not answer" and keeps its in-memory decision.
--
-- One take in 100 also clears up to 200 expired windows, which is more than takes
-- can add, so a flood of new keys cannot outrun the clean-up between gc runs. It
-- runs last and skips locked rows: it takes rows out of the sorted order above, so
-- it must never wait for one, or two takes could deadlock.
CREATE OR REPLACE FUNCTION public.rate_limit_take(p_keys bytea[], p_limits int[], p_windows int[])
RETURNS TABLE (allowed boolean, retry_after int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '300ms' AS $$
DECLARE
  v_take record;
  v_hits int;
  v_window_start timestamptz;
  v_first_denied bigint;
BEGIN
  IF COALESCE(cardinality(p_keys), 0) NOT BETWEEN 1 AND 16
     OR cardinality(p_limits) IS DISTINCT FROM cardinality(p_keys)
     OR cardinality(p_windows) IS DISTINCT FROM cardinality(p_keys) THEN
    RAISE EXCEPTION 'rate_limit_take: expected 1 to 16 keys with one limit and one window each'
      USING ERRCODE = '22023';
  END IF;

  allowed := true;
  retry_after := 0;

  FOR v_take IN
    SELECT t.key_hash, t.max_hits, t.window_seconds, t.ord
      FROM unnest(p_keys, p_limits, p_windows) WITH ORDINALITY
        AS t(key_hash, max_hits, window_seconds, ord)
     ORDER BY t.key_hash, t.window_seconds
  LOOP
    IF v_take.max_hits IS NULL OR v_take.max_hits < 1
       OR v_take.window_seconds IS NULL OR v_take.window_seconds NOT BETWEEN 1 AND 2592000 THEN
      RAISE EXCEPTION 'rate_limit_take: limits must be at least 1 and windows from 1 second to 30 days'
        USING ERRCODE = '22023';
    END IF;

    -- A NULL or malformed key_hash is refused by the table's own constraints.
    INSERT INTO public.rate_limit_hits AS h (key_hash, window_seconds, window_start, hits)
    VALUES (v_take.key_hash, v_take.window_seconds, now(), 1)
    ON CONFLICT (key_hash, window_seconds) DO UPDATE
      SET window_start = CASE
            WHEN h.window_start + h.window_seconds * interval '1 second' <= now() THEN now()
            ELSE h.window_start
          END,
          -- LEAST keeps a counter that is already far over its limit from overflowing.
          hits = CASE
            WHEN h.window_start + h.window_seconds * interval '1 second' <= now() THEN 1
            ELSE LEAST(h.hits, 2147483646) + 1
          END
    RETURNING h.hits, h.window_start INTO v_hits, v_window_start;

    IF v_hits > v_take.max_hits AND (v_first_denied IS NULL OR v_take.ord < v_first_denied) THEN
      v_first_denied := v_take.ord;
      allowed := false;
      retry_after := GREATEST(
        1,
        ceil(extract(epoch FROM v_window_start + v_take.window_seconds * interval '1 second' - now()))::int
      );
    END IF;
  END LOOP;

  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_hits
     WHERE ctid = ANY (ARRAY(
       SELECT e.ctid FROM public.rate_limit_hits e
        WHERE e.window_start + e.window_seconds * interval '1 second' <= now()
        LIMIT 200
        FOR UPDATE SKIP LOCKED
     ));
  END IF;

  RETURN NEXT;
END $$;

-- Delete expired windows and return how many went. Run daily by the entitlements
-- cron when the store is in use, to catch what the takes leave behind when traffic
-- stops. Each row's expiry is re-checked under its lock, so a window that a take
-- has just restarted is kept.
CREATE OR REPLACE FUNCTION public.rate_limit_gc()
RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH deleted AS (
    DELETE FROM public.rate_limit_hits
     WHERE window_start + window_seconds * interval '1 second' <= now()
    RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;

REVOKE EXECUTE ON FUNCTION public.rate_limit_take(bytea[], int[], int[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rate_limit_gc() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_take(bytea[], int[], int[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.rate_limit_gc() TO service_role;
