-- Migration 053: cohort chat moderation (PRD §11 — mentors moderate the cohort
-- chat: delete messages, and receive messages flagged by mentees).
--
-- Soft-delete (deleted_at) so deletions are auditable; flagged_at/flagged_by mark
-- a message for the mentor's attention. Reads filter out deleted messages.

alter table public.chat_messages
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.members(id) on delete set null,
  add column if not exists flagged_at timestamptz,
  add column if not exists flagged_by uuid references public.members(id) on delete set null;

create index if not exists chat_messages_flagged_idx
  on public.chat_messages (channel_id) where flagged_at is not null and deleted_at is null;
