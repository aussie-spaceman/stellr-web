-- Migration 014: Emergency contact "Relationship To Participant"
-- New dropdown field collected on all registration forms. Mapped to the
-- DocuSign tab label "MinorRelationship" for parental-consent envelopes.
-- Options (enforced at form/API level): Parent, Legal Guardian, Spouse,
-- Grandparent, Teacher.

-- Per-participant value (public individual + group registrations, sheet sync)
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text;

-- Per-member value (member onboarding, admin add-member, group-join links)
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS ec_relationship text;
