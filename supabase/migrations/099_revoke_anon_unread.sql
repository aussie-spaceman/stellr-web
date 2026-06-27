-- 099_revoke_anon_unread.sql
-- Security hardening (advisor lint 0028 anon_security_definer_function_executable).
--
-- space_unread_counts(uuid) is a SECURITY DEFINER RPC helper that is NOT referenced in
-- any RLS policy and is called only server-side (lib/community-feed.ts via the service
-- role). Revoke anon EXECUTE so a signed-out caller can't enumerate a member's per-space
-- unread counts through /rest/v1/rpc. authenticated + service_role retain access.
--
-- NOTE: can_read_space and can_read_chat_channel are intentionally LEFT executable by anon
-- — they ARE referenced in RLS policies (community_posts / community_comments / chat_messages),
-- so revoking anon EXECUTE would make policy evaluation ERROR for any anon-role read rather
-- than cleanly return no rows. Their exposure (a boolean for a given uuid pair) is low risk.

revoke execute on function public.space_unread_counts(uuid) from anon;
