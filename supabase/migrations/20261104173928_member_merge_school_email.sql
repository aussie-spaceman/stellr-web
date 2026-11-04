-- Member merge + school email (4 Nov 2026).
--
-- 1. A second, optional email for members under 18: `school_email`.
--    `members.email` stays the single primary address (login matching, consent
--    forms, receipts, sheet sync) and holds the PERSONAL address whenever there
--    is one; the school address is used only when no personal address exists.
--    School networks often block DocuSign, Stripe and other mail, which is how a
--    student ended up registered twice (once per address). `participants` gets
--    the same column so a roster row carries what the organiser entered.
--
-- 2. `merge_members(keep, drop, fields, actor, summary)` folds one member record
--    into another in a single transaction, for the admin "Merge members" review:
--      - frees the dropped row's unique values (email, login, member code),
--      - repoints every row that references the dropped member — every
--        single-column foreign key to members (in any schema), plus the
--        member_id columns that carry no foreign key — to the kept member; a
--        row that would duplicate one the kept member already has (a unique
--        violation) is removed instead,
--      - applies the admin-approved field values to the kept member,
--      - permanently deletes the dropped row and its audit_log trail (the owner
--        asked for no snapshot of the removed record),
--      - records the merge in the kept member's activity history.
--    The caller (app/api/admin/members/merge) is admin-only and uses the
--    service-role client; the function is sealed from the public API roles.

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS school_email text;
ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS school_email text;

COMMENT ON COLUMN public.members.school_email IS
  'Optional school address (members under 18). members.email is the primary address and holds the personal address when one exists.';
COMMENT ON COLUMN public.participants.school_email IS
  'Optional school address as entered on the roster. participants.email is the primary (personal when given).';

CREATE OR REPLACE FUNCTION public.merge_members(
  p_keep    uuid,
  p_drop    uuid,
  p_fields  jsonb,
  p_actor   uuid,
  p_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_keep    public.members%ROWTYPE;
  v_drop    public.members%ROWTYPE;
  v_rec     public.members%ROWTYPE;
  r         record;
  t         record;
  v_key     text;
  v_moved   int;
  v_removed int;
  v_counts  jsonb := '{}'::jsonb;
  -- Columns a merge may set on the kept member. Identity columns (id,
  -- membership_id, created_at, the unsubscribe token) always stay the kept
  -- member's own.
  v_allowed text[] := ARRAY[
    'first_name', 'last_name', 'nickname', 'date_of_birth', 'gender', 'phone',
    'email', 'school_email', 'discord_handle', 'age_bracket', 'event_role',
    'grade', 'grade_auto_promote', 'tshirt_size', 'graduation_year',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone', 'ec_relationship',
    'health_conditions', 'profile_photo_url', 'stripe_customer_id',
    'clerk_user_id', 'member_code', 'marketing_consent', 'is_active'
  ];
BEGIN
  IF p_keep IS NULL OR p_drop IS NULL OR p_keep = p_drop THEN
    RAISE EXCEPTION 'merge_members: two different members are required';
  END IF;

  -- Lock in a stable order so two concurrent merges of the same pair cannot
  -- deadlock.
  PERFORM 1 FROM public.members WHERE id IN (p_keep, p_drop) ORDER BY id FOR UPDATE;
  SELECT * INTO v_keep FROM public.members WHERE id = p_keep;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_members: member % not found', p_keep; END IF;
  SELECT * INTO v_drop FROM public.members WHERE id = p_drop;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_members: member % not found', p_drop; END IF;

  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_fields, '{}'::jsonb)) LOOP
    IF NOT v_key = ANY (v_allowed) THEN
      RAISE EXCEPTION 'merge_members: % cannot be set by a merge', v_key;
    END IF;
  END LOOP;

  -- 1. Free the dropped row's unique values so the kept member can take them.
  UPDATE public.members
     SET email = 'merged-' || id::text || '@merge.invalid',
         clerk_user_id = NULL,
         member_code = NULL
   WHERE id = p_drop;

  -- 2a. Repoint every single-column foreign key to members. Entitlements move
  --     before bookings: the booking guard checks a booking's entitlement
  --     belongs to the same member.
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname::text AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.members'::regclass
       AND array_length(c.conkey, 1) = 1
     ORDER BY (c.conrelid::regclass::text = 'entitlements.bookings'), c.conrelid::regclass::text, a.attname
  LOOP
    v_moved := 0; v_removed := 0;
    FOR t IN EXECUTE format('SELECT ctid FROM %s WHERE %I = $1', r.tbl, r.col) USING p_drop LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', r.tbl, r.col) USING p_keep, t.ctid;
        v_moved := v_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        -- The kept member already has this row (a role, a school link, ...).
        EXECUTE format('DELETE FROM %s WHERE ctid = $1', r.tbl) USING t.ctid;
        v_removed := v_removed + 1;
      END;
    END LOOP;
    IF v_moved + v_removed > 0 THEN
      v_counts := v_counts || jsonb_build_object(
        r.tbl::text || '.' || r.col,
        jsonb_build_object('moved', v_moved, 'duplicates_removed', v_removed));
    END IF;
  END LOOP;

  -- 2b. member_id columns with no foreign key (DocuSign mirror tables, survey
  --     answers, the access audit). Base tables only.
  FOR r IN
    SELECT format('%I.%I', c.table_schema, c.table_name) AS tbl, c.column_name::text AS col
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.column_name = 'member_id'
       AND c.data_type = 'uuid'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint fk
          JOIN pg_attribute fa ON fa.attrelid = fk.conrelid AND fa.attnum = ANY (fk.conkey)
          WHERE fk.contype = 'f'
            AND fk.confrelid = 'public.members'::regclass
            AND fk.conrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
            AND fa.attname = 'member_id')
  LOOP
    v_moved := 0; v_removed := 0;
    FOR t IN EXECUTE format('SELECT ctid FROM %s WHERE %I = $1', r.tbl, r.col) USING p_drop LOOP
      BEGIN
        EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', r.tbl, r.col) USING p_keep, t.ctid;
        v_moved := v_moved + 1;
      EXCEPTION WHEN unique_violation THEN
        EXECUTE format('DELETE FROM %s WHERE ctid = $1', r.tbl) USING t.ctid;
        v_removed := v_removed + 1;
      END;
    END LOOP;
    IF v_moved + v_removed > 0 THEN
      v_counts := v_counts || jsonb_build_object(
        r.tbl || '.' || r.col,
        jsonb_build_object('moved', v_moved, 'duplicates_removed', v_removed));
    END IF;
  END LOOP;

  -- 3. Apply the approved values to the kept member, typed by the row type.
  v_rec := jsonb_populate_record(v_keep, COALESCE(p_fields, '{}'::jsonb));
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(p_fields, '{}'::jsonb)) LOOP
    EXECUTE format('UPDATE public.members SET %I = ($1).%I WHERE id = $2', v_key, v_key)
      USING v_rec, p_keep;
  END LOOP;

  -- 4. Permanently delete the dropped row, then its audit trail (no snapshot).
  DELETE FROM public.members WHERE id = p_drop;
  DELETE FROM public.audit_log WHERE table_name = 'members' AND record_id = p_drop;

  -- 5. Record the merge on the only remaining record.
  INSERT INTO public.member_activity_log
    (member_id, actor_type, actor_member_id, actor_label, category, action, summary, metadata)
  VALUES (
    p_keep, 'admin', p_actor, COALESCE(p_summary->>'actorLabel', NULL), 'account', 'member_merged',
    'Merged duplicate record ' || COALESCE(v_drop.membership_id, v_drop.id::text) || ' into this member',
    jsonb_build_object(
      'mergedMemberId', v_drop.id,
      'mergedMembershipId', v_drop.membership_id,
      'mergedCreatedAt', v_drop.created_at,
      'fields', COALESCE(p_summary->'fields', '{}'::jsonb),
      'moved', v_counts)
  );

  RETURN jsonb_build_object(
    'keptMemberId', p_keep,
    'droppedMemberId', p_drop,
    'droppedMembershipId', v_drop.membership_id,
    'droppedClerkUserId', v_drop.clerk_user_id,
    'moved', v_counts);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_members(uuid, uuid, jsonb, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_members(uuid, uuid, jsonb, uuid, jsonb) TO service_role;
