-- Who pays for each person in a group (9 Nov 2026).
--
-- A group used to pay one way: invoice, card, or everyone individually. A teacher
-- asked for an invoice for herself only, with her students paying by their own
-- links. So each participant now records who pays for their place:
--
--   group  → the organizer's invoice (or card payment) covers it
--   self   → the person pays by their own pay link
--   shared → an adult whose fee is split across the students' links (reserved
--            for the "students share the teacher's cost" option)
--
-- NULL keeps the old meaning: the group's flags decide (lib/group-payer.ts).
--
-- late_joiner_payer is set only on a group where some people are on the invoice
-- and some pay by link ("Invoice for some"). It decides how people who join later
-- (join link, sheet sync, manual add) pay. NULL everywhere else.
--
-- Idempotent: safe to re-run under the CLI or the Supabase MCP.

ALTER TABLE public.participants ADD COLUMN IF NOT EXISTS payer text;
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS late_joiner_payer text;

-- Drop-then-add keeps a re-run harmless without DDL inside a DO block (the
-- tenancy lint forbids that).
ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_payer_check;
ALTER TABLE public.participants
  ADD CONSTRAINT participants_payer_check CHECK (payer IS NULL OR payer IN ('group', 'self', 'shared'));

ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_late_joiner_payer_check;
ALTER TABLE public.registrations
  ADD CONSTRAINT registrations_late_joiner_payer_check CHECK (late_joiner_payer IS NULL OR late_joiner_payer IN ('group', 'self'));
