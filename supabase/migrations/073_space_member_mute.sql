-- Migration 073: Spaces moderation — enforce member mute + invite notifications
--
-- Two small, additive follow-ups closing gaps left by the Spaces deploy (069/071):
--   1. community_space_members.muted — the "Mute member" moderation action was a
--      no-op stub (route returned {ok:true, note:'mute not yet enforced'}). This
--      column is now the gate checked by the post/comment write paths so a muted
--      member genuinely cannot post in that space.
--   2. extend community_notifications.type to allow 'invite' so a space invite can
--      raise an in-app notification (+ email) for the invited member, not just a
--      silent roster row.

-- ─── community_space_members.muted ─────────────────────────────────────────────
ALTER TABLE public.community_space_members
  ADD COLUMN IF NOT EXISTS muted boolean NOT NULL DEFAULT false;

-- ─── community_notifications: add the 'invite' type ─────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.community_notifications DROP CONSTRAINT IF EXISTS community_notifications_type_check;
  ALTER TABLE public.community_notifications
    ADD CONSTRAINT community_notifications_type_check
    CHECK (type IN ('reply', 'mention', 'announcement', 'resource',
                    'session', 'session_reminder', 'recording', 'action', 'invite'));
EXCEPTION WHEN others THEN NULL; END $$;
