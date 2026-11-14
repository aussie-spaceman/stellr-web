-- Google Sheets push channels get a per-channel token (threat model §6.11, S0).
--
-- The Drive push-notification webhook (app/api/webhooks/google-sheets/route.ts) was
-- authenticated only by looking up the X-Goog-Channel-Id header. Each channel now
-- carries a random 32-byte token, registered with Google as the channel `token`;
-- Google echoes it in X-Goog-Channel-Token on every notification and the webhook
-- compares the two in constant time.
--
-- Nullable on purpose: channels registered before this change have no token. The
-- webhook accepts such a row (with a warning) only until that channel's expiration,
-- at most 6 days; the next "Sync From Sheet" after expiry registers a new channel
-- with a token (app/api/members/teams/[id]/sheet-sync/route.ts).
--
-- The token is a shared secret. Only the service role reads this table: RLS stays
-- enabled with its single service_role policy, and the table-level grants that the
-- baseline gave anon and authenticated are revoked here so neither role can touch
-- the new column (or any other) even if a policy were added later.

ALTER TABLE public.sheet_watch_channels
  ADD COLUMN IF NOT EXISTS token text;

COMMENT ON COLUMN public.sheet_watch_channels.token IS
  'Per-channel secret sent to Google as the watch channel token and compared with X-Goog-Channel-Token on each notification. NULL only for channels registered before 2026-11-14; those are refused after they expire.';

REVOKE ALL ON public.sheet_watch_channels FROM PUBLIC, anon, authenticated;
