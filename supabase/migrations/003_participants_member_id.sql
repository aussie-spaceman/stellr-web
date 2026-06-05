-- Migration 003: link participants to the members table
-- Run in Supabase SQL Editor after deploying the membership schema

ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS participants_member_id_idx ON public.participants(member_id);

-- Backfill: link existing participants to members by matching email
UPDATE public.participants p
SET member_id = m.id
FROM public.members m
WHERE p.email = m.email
  AND p.member_id IS NULL;
