-- S4 "platform_audit_events" (multi-tenancy plan): the hash-chained,
-- append-only audit primitive.
--
-- One row per audited action: who did it (actor + actor_kind), what
-- (action, a dotted name such as 'support.impersonate.start'), to what
-- (target_table + target_id), why (reason) and ids-only metadata.
--
-- CHAINS. Each tenant has its own chain, and platform-level events (tenant_id
-- NULL) form one more. Every row stores its position in its chain
-- (chain_seq, from 1), the previous row's hash (prev_hash, NULL only for the
-- first row) and its own hash:
--
--   hash = sha256(prev_hash || canonical(row))
--
-- canonical(row) is platform_audit_canonical(): a length-prefixed text form of
-- every column except id, prev_hash and hash. lib/audit/platform.ts recomputes
-- it outside the database (verifyChain), so a replaced verify function cannot
-- hide a break. A tenant can verify its own chain without seeing anyone else's.
--
-- APPEND-ONLY, EVEN AGAINST service_role.
--   * service_role holds SELECT only: no INSERT, UPDATE, DELETE or TRUNCATE.
--   * BEFORE UPDATE / DELETE (row) and BEFORE TRUNCATE (statement) triggers
--     raise for everyone, the table owner included.
--   * Rows are added only through platform_audit_append(). It is SECURITY
--     DEFINER because that is the only way to let the server append without
--     holding INSERT on the table. It pins search_path and EXECUTE is revoked
--     from PUBLIC, anon and authenticated.
--   * A BEFORE INSERT trigger computes chain_seq, prev_hash, hash and
--     occurred_at under a per-chain advisory lock. Whatever a caller passes
--     for those columns is overwritten, so no caller can supply a hash.
--     UNIQUE (tenant_id, chain_seq) NULLS NOT DISTINCT is the backstop: two
--     writers that somehow read the same predecessor collide instead of
--     forking the chain.
--
-- WHAT THE TABLE OWNER CAN STILL DO, AND HOW IT IS CAUGHT. The owner
-- (postgres) can disable the triggers, edit or delete rows, or replace these
-- functions. An edited or deleted row in the middle of a chain breaks it:
-- verification recomputes every hash and checks chain_seq is contiguous. Two
-- things cannot be seen from inside the database: deleting the newest rows of
-- a chain, and rewriting a whole chain with fresh hashes. Both are caught by
-- comparing the chain with heads recorded somewhere the owner cannot edit
-- (scripts/verify-audit-chain.ts --heads / --expect). docs/PLATFORM-AUDIT.md.
--
-- PERSONAL DATA. metadata holds ids, counts, flags and short codes only, never
-- names, emails, phone numbers, dates of birth or free text about a person.
-- lib/audit/platform.ts keeps only id-shaped string values and drops keys that
-- name personal data before the write. reason is a short code; the helper
-- redacts anything else.
--
-- BACKGROUND ONLY. Nothing calls platform_audit_append() unless
-- PLATFORM_AUDIT_ENABLED=true, which is off by default. Additive: no existing
-- table, function or flow changes. No custom GUCs, ALTER ROLE or other
-- superuser-only commands: the hosted migration role is not a superuser.

CREATE TABLE IF NOT EXISTS public.platform_audit_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL = the platform chain (events that belong to no tenant).
  tenant_id     uuid REFERENCES public.tenants (id) ON DELETE RESTRICT,
  chain_seq     bigint NOT NULL CHECK (chain_seq >= 1),
  actor         text NOT NULL,
  actor_kind    text NOT NULL CHECK (actor_kind IN ('user', 'system', 'cron')),
  action        text NOT NULL
                  CHECK (char_length(action) <= 100
                         AND action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,5}$'),
  target_table  text CHECK (target_table IS NULL
                            OR (char_length(target_table) <= 127
                                AND target_table ~ '^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$')),
  -- An id, never an email: no '@' and no whitespace.
  target_id     text CHECK (target_id IS NULL OR target_id ~ '^[A-Za-z0-9_:./-]{1,200}$'),
  reason        text CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 500),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
                  CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096),
  occurred_at   timestamptz NOT NULL,
  prev_hash     bytea CHECK (prev_hash IS NULL OR octet_length(prev_hash) = 32),
  hash          bytea NOT NULL CHECK (octet_length(hash) = 32),
  CONSTRAINT platform_audit_events_actor_check CHECK (
    (actor_kind = 'system' AND actor = 'system')
    OR (actor_kind = 'cron' AND actor ~ '^cron:[a-z0-9][a-z0-9._-]{0,62}$')
    OR (actor_kind = 'user' AND actor ~ '^user_[A-Za-z0-9]{1,64}$')
  ),
  CONSTRAINT platform_audit_events_target_check CHECK (target_id IS NULL OR target_table IS NOT NULL),
  CONSTRAINT platform_audit_events_genesis_check CHECK ((chain_seq = 1) = (prev_hash IS NULL)),
  CONSTRAINT platform_audit_events_chain_unique UNIQUE NULLS NOT DISTINCT (tenant_id, chain_seq)
);

-- The unique constraint's index is led by tenant_id: it serves per-tenant
-- reads, the head lookup in the chain trigger, and the tenancy lint's
-- "index led by tenant_id" rule.
CREATE INDEX IF NOT EXISTS platform_audit_events_tenant_id_occurred_idx
  ON public.platform_audit_events (tenant_id, occurred_at);
CREATE INDEX IF NOT EXISTS platform_audit_events_action_idx
  ON public.platform_audit_events (action, occurred_at);

COMMENT ON TABLE public.platform_audit_events IS
  'S4 audit primitive. Append-only (even for service_role) and hash-chained per tenant, plus one platform chain (tenant_id NULL). Written only through platform_audit_append(). metadata holds ids only, never personal data. docs/PLATFORM-AUDIT.md.';
COMMENT ON COLUMN public.platform_audit_events.tenant_id IS
  'The chain this row belongs to. NULL = the platform chain.';
COMMENT ON COLUMN public.platform_audit_events.actor IS
  'A Clerk user id (actor_kind user), ''system'', or ''cron:<job>''.';
COMMENT ON COLUMN public.platform_audit_events.metadata IS
  'Ids, counts, flags and short codes only. Never names, emails, phone numbers, dates of birth or free text about a person.';
COMMENT ON COLUMN public.platform_audit_events.hash IS
  'sha256(prev_hash || platform_audit_canonical(row)). Computed by the insert trigger; callers cannot supply it.';

-- ── Canonical form and digest ────────────────────────────────────────────────

-- One field: '~' for NULL, otherwise '<byte length>:<value>'. The length
-- prefix makes the joined form unambiguous whatever the values contain.
CREATE OR REPLACE FUNCTION public.platform_audit_field(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_value IS NULL THEN '~'
              ELSE pg_catalog.octet_length(p_value)::text || ':' || p_value END
$$;

-- The text a row's hash covers. Mirrored by canonicalRow() in
-- lib/audit/platform.ts; change both together (and bump 'pae1').
CREATE OR REPLACE FUNCTION public.platform_audit_canonical(
  p_tenant uuid, p_seq bigint, p_actor text, p_actor_kind text, p_action text,
  p_target_table text, p_target_id text, p_reason text, p_metadata jsonb,
  p_occurred_at timestamptz
) RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.concat_ws('|',
    'pae1',
    public.platform_audit_field(p_tenant::text),
    public.platform_audit_field(p_seq::text),
    public.platform_audit_field(p_actor),
    public.platform_audit_field(p_actor_kind),
    public.platform_audit_field(p_action),
    public.platform_audit_field(p_target_table),
    public.platform_audit_field(p_target_id),
    public.platform_audit_field(p_reason),
    public.platform_audit_field(p_metadata::text),
    public.platform_audit_field(
      pg_catalog.to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  )
$$;

CREATE OR REPLACE FUNCTION public.platform_audit_digest(
  p_prev bytea, p_tenant uuid, p_seq bigint, p_actor text, p_actor_kind text, p_action text,
  p_target_table text, p_target_id text, p_reason text, p_metadata jsonb,
  p_occurred_at timestamptz
) RETURNS bytea LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT pg_catalog.sha256(
    coalesce(p_prev, ''::bytea)
    || pg_catalog.convert_to(
         public.platform_audit_canonical(p_tenant, p_seq, p_actor, p_actor_kind, p_action,
                                         p_target_table, p_target_id, p_reason, p_metadata, p_occurred_at),
         'UTF8'))
$$;

-- ── Insert trigger: the chain is computed here, never by the caller ─────────

CREATE OR REPLACE FUNCTION public.platform_audit_events_chain()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_prev bytea;
  v_seq  bigint;
BEGIN
  -- One writer per chain at a time. Statements in a volatile plpgsql function
  -- take a fresh snapshot under READ COMMITTED, so the head read below sees
  -- the row the previous lock holder committed.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('platform_audit:' || coalesce(NEW.tenant_id::text, 'platform'), 0));

  IF NEW.tenant_id IS NULL THEN
    SELECT e.hash, e.chain_seq INTO v_prev, v_seq
      FROM public.platform_audit_events e
     WHERE e.tenant_id IS NULL
     ORDER BY e.chain_seq DESC LIMIT 1;
  ELSE
    SELECT e.hash, e.chain_seq INTO v_prev, v_seq
      FROM public.platform_audit_events e
     WHERE e.tenant_id = NEW.tenant_id
     ORDER BY e.chain_seq DESC LIMIT 1;
  END IF;

  NEW.chain_seq   := coalesce(v_seq, 0) + 1;
  NEW.prev_hash   := v_prev;
  -- Millisecond precision, so the timestamp round-trips exactly through
  -- JavaScript for off-database verification.
  NEW.occurred_at := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  NEW.metadata    := coalesce(NEW.metadata, '{}'::jsonb);
  NEW.hash        := public.platform_audit_digest(
    NEW.prev_hash, NEW.tenant_id, NEW.chain_seq, NEW.actor, NEW.actor_kind, NEW.action,
    NEW.target_table, NEW.target_id, NEW.reason, NEW.metadata, NEW.occurred_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS platform_audit_events_chain ON public.platform_audit_events;
CREATE TRIGGER platform_audit_events_chain
  BEFORE INSERT ON public.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.platform_audit_events_chain();

-- ── Append-only guards ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.platform_audit_events_refuse()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only (% refused)', TG_OP
    USING ERRCODE = 'P0001';
END $$;

DROP TRIGGER IF EXISTS platform_audit_events_no_update_delete ON public.platform_audit_events;
CREATE TRIGGER platform_audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.platform_audit_events_refuse();

DROP TRIGGER IF EXISTS platform_audit_events_no_truncate ON public.platform_audit_events;
CREATE TRIGGER platform_audit_events_no_truncate
  BEFORE TRUNCATE ON public.platform_audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.platform_audit_events_refuse();

-- ── Append ───────────────────────────────────────────────────────────────────

-- The only way in for the server. SECURITY DEFINER is unavoidable: service_role
-- holds no INSERT on the table, so the append must run as the owner. The
-- function inserts only the caller's descriptive columns; the trigger computes
-- the chain. Lock waits are capped so a stuck chain cannot hold up a caller
-- (lib/audit/platform.ts also times out and never throws).
CREATE OR REPLACE FUNCTION public.platform_audit_append(
  p_tenant       uuid,
  p_actor        text,
  p_actor_kind   text,
  p_action       text,
  p_target_table text DEFAULT NULL,
  p_target_id    text DEFAULT NULL,
  p_reason       text DEFAULT NULL,
  p_metadata     jsonb DEFAULT '{}'::jsonb
) RETURNS public.platform_audit_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row public.platform_audit_events;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '2s', true);
  INSERT INTO public.platform_audit_events
    (tenant_id, actor, actor_kind, action, target_table, target_id, reason, metadata)
  VALUES
    (p_tenant, p_actor, p_actor_kind, p_action, p_target_table, p_target_id, p_reason,
     coalesce(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

-- ── Verify and heads ─────────────────────────────────────────────────────────

-- Recomputes one chain (p_tenant NULL = the platform chain). Returns one row:
-- ok, rows checked, the first bad row (id, chain_seq) and why, and the head.
-- SECURITY INVOKER: it reads with the caller's rights.
CREATE OR REPLACE FUNCTION public.platform_audit_verify(p_tenant uuid)
RETURNS TABLE (ok boolean, checked bigint, first_bad_id bigint, first_bad_seq bigint,
               problem text, head_seq bigint, head_hash text)
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  r        record;
  v_prev   bytea := NULL;
  v_expect bigint := 1;
  v_n      bigint := 0;
BEGIN
  FOR r IN
    SELECT e.* FROM public.platform_audit_events e
     WHERE (p_tenant IS NULL AND e.tenant_id IS NULL) OR e.tenant_id = p_tenant
     ORDER BY e.chain_seq
  LOOP
    v_n := v_n + 1;
    IF r.chain_seq <> v_expect THEN
      RETURN QUERY SELECT false, v_n, r.id, r.chain_seq, 'sequence gap'::text, v_expect - 1, pg_catalog.encode(v_prev, 'hex');
      RETURN;
    END IF;
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      RETURN QUERY SELECT false, v_n, r.id, r.chain_seq, 'prev_hash does not match the previous row'::text, v_expect - 1, pg_catalog.encode(v_prev, 'hex');
      RETURN;
    END IF;
    IF r.hash IS DISTINCT FROM public.platform_audit_digest(
         v_prev, r.tenant_id, r.chain_seq, r.actor, r.actor_kind, r.action,
         r.target_table, r.target_id, r.reason, r.metadata, r.occurred_at) THEN
      RETURN QUERY SELECT false, v_n, r.id, r.chain_seq, 'hash does not match the row'::text, v_expect - 1, pg_catalog.encode(v_prev, 'hex');
      RETURN;
    END IF;
    v_prev   := r.hash;
    v_expect := v_expect + 1;
  END LOOP;
  RETURN QUERY SELECT true, v_n, NULL::bigint, NULL::bigint, NULL::text, v_expect - 1, pg_catalog.encode(v_prev, 'hex');
END $$;

-- The newest row of every chain, for anchoring outside the database.
CREATE OR REPLACE FUNCTION public.platform_audit_heads()
RETURNS TABLE (tenant_id uuid, chain_seq bigint, hash text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT DISTINCT ON (e.tenant_id) e.tenant_id, e.chain_seq, pg_catalog.encode(e.hash, 'hex')
    FROM public.platform_audit_events e
   ORDER BY e.tenant_id, e.chain_seq DESC
$$;

-- ── Privileges ───────────────────────────────────────────────────────────────

ALTER TABLE public.platform_audit_events ENABLE ROW LEVEL SECURITY;
-- Supabase's default privileges grant ALL on new tables to anon, authenticated
-- and service_role. Take everything back, then give service_role read only.
REVOKE ALL ON public.platform_audit_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_audit_events TO service_role;
DO $$ BEGIN
  CREATE POLICY "service role read platform_audit_events"
    ON public.platform_audit_events FOR SELECT TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

REVOKE EXECUTE ON FUNCTION public.platform_audit_field(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_canonical(uuid, bigint, text, text, text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_digest(bytea, uuid, bigint, text, text, text, text, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_events_chain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_events_refuse() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_verify(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_audit_heads() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.platform_audit_field(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_audit_canonical(uuid, bigint, text, text, text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_audit_digest(bytea, uuid, bigint, text, text, text, text, text, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_audit_append(uuid, text, text, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_audit_verify(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.platform_audit_heads() TO service_role;
