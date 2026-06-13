-- Migration 036 — give every PERSON one stable Membership ID, and make member
-- identity case-insensitive.
--
-- Background: migration 001 put membership_id on PARTICIPANTS — one id per person
-- *per event registration* — so the same human ends up with several "Member IDs",
-- the portal/admin/emails disagree on which to show, and deleting a registration
-- can erase an id that's already on a badge. This moves the canonical id onto
-- members (one per person) and turns participants.membership_id into a copy that
-- always matches, so every existing reader (sheet column A, Stripe receipt emails,
-- roster) keeps working but now agrees.
--
-- ORDER OF OPERATIONS: run this migration BEFORE deploying the matching app code —
-- the new readers select members.membership_id, which only exists after this runs.
--
-- PRE-FLIGHT for the email step (§6): if it aborts, you have case-duplicate member
-- rows to merge first. Find them with:
--   SELECT lower(email), count(*) FROM public.members
--   GROUP BY lower(email) HAVING count(*) > 1;

BEGIN;

-- ── 1. Canonical id column on members ────────────────────────────────────────
-- Drawn from the SAME sequence as participants so the two pools can never collide
-- while both are in use during the transition.
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS membership_id text;

-- ── 2. Backfill ──────────────────────────────────────────────────────────────
-- Each existing member adopts the LOWEST membership_id across their participant
-- rows — their original id, the one most likely already printed on a badge or in a
-- confirmation email. (Ids are fixed-width zero-padded, so MIN on text == numeric.)
UPDATE public.members m
SET membership_id = sub.min_id
FROM (
  SELECT member_id, MIN(membership_id) AS min_id
  FROM public.participants
  WHERE member_id IS NOT NULL
  GROUP BY member_id
) sub
WHERE m.id = sub.member_id
  AND m.membership_id IS NULL;

-- Members with no participant row (admin-created, website subscribers) draw a fresh
-- id from the shared sequence. nextval is evaluated per-row, so each gets a distinct id.
UPDATE public.members
SET membership_id = lpad(nextval('participants_membership_id_seq')::text, 7, '0')
WHERE membership_id IS NULL;

-- ── 3. Make it canonical: auto-assign + unique + not null ─────────────────────
ALTER TABLE public.members
  ALTER COLUMN membership_id SET DEFAULT lpad(nextval('participants_membership_id_seq')::text, 7, '0');
ALTER TABLE public.members
  ALTER COLUMN membership_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_membership_id_idx
  ON public.members (membership_id);

-- ── 4. participants.membership_id becomes a denormalised COPY ─────────────────
-- A person now has the SAME id across all their event rows, so it can no longer be
-- globally unique on participants. Drop the unique constraint + unique index from
-- migration 001 and replace with a plain index for lookups/joins.
ALTER TABLE public.participants
  DROP CONSTRAINT IF EXISTS participants_membership_id_key;
DROP INDEX IF EXISTS public.participants_membership_id_idx;
CREATE INDEX IF NOT EXISTS participants_membership_id_idx
  ON public.participants (membership_id);

-- ── 5. Inherit-on-insert trigger ─────────────────────────────────────────────
-- A new participant row copies its member's canonical id, so the sheet, roster and
-- receipt emails all show the person's stable id without any app changes. An orphan
-- row (member upsert failed → member_id null) keeps the sequence-minted default.
CREATE OR REPLACE FUNCTION public.participants_inherit_member_membership_id()
RETURNS trigger AS $$
DECLARE m_id text;
BEGIN
  IF NEW.member_id IS NOT NULL THEN
    SELECT membership_id INTO m_id FROM public.members WHERE id = NEW.member_id;
    IF m_id IS NOT NULL THEN
      NEW.membership_id := m_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS participants_inherit_membership_id_trg ON public.participants;
CREATE TRIGGER participants_inherit_membership_id_trg
  BEFORE INSERT ON public.participants
  FOR EACH ROW
  EXECUTE FUNCTION public.participants_inherit_member_membership_id();

-- ── 6. Case-insensitive member identity ──────────────────────────────────────
-- The app now lowercases email on every write; normalise what's already stored and
-- enforce it. This UPDATE aborts the whole migration (transactional) if two rows
-- collapse to the same address — that means a case-duplicate pair exists; merge it
-- (re-point participants/member_memberships/member_schools, delete the loser) and
-- re-run. The existing plain UNIQUE(email) stays as-is and keeps working since all
-- emails are now lowercase; the functional index below is the going-forward guard.
UPDATE public.members
SET email = lower(email)
WHERE email IS NOT NULL AND email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS members_email_lower_idx
  ON public.members (lower(email));

COMMIT;
