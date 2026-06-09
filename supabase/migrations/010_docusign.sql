-- Migration 010: DocuSign parental consent tracking
-- Stores one envelope per minor participant per event.

CREATE TABLE public.docusign_envelopes (
  id                uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  participant_id    uuid         REFERENCES public.participants(id) ON DELETE CASCADE,
  member_id         uuid         REFERENCES public.members(id) ON DELETE SET NULL,
  event_slug        text         NOT NULL,
  event_title       text         NOT NULL,
  envelope_id       text         NOT NULL UNIQUE,
  status            text         NOT NULL DEFAULT 'sent'
                                  CHECK (status IN ('created','sent','delivered','completed','declined','voided')),
  signer_name       text         NOT NULL,
  signer_email      text         NOT NULL,
  minor_name        text         NOT NULL,
  sent_at           timestamptz  NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  declined_at       timestamptz,
  reminder_sent_at  timestamptz,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX docusign_envelopes_member_id_idx      ON public.docusign_envelopes (member_id);
CREATE INDEX docusign_envelopes_participant_id_idx ON public.docusign_envelopes (participant_id);
CREATE INDEX docusign_envelopes_status_idx         ON public.docusign_envelopes (status);
CREATE INDEX docusign_envelopes_sent_at_idx        ON public.docusign_envelopes (sent_at);
