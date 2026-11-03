import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseFetch, supabasePublicKey } from '@/lib/supabase-keys'

// Both clients use the public key: the publishable key, or the legacy anon key
// until it is retired (lib/supabase-keys.ts). Never a secret key: these run in
// the browser, where Supabase refuses one anyway. supabaseFetch keeps the
// publishable key off `Authorization: Bearer`, which carries the Clerk session
// token or nothing.

// Browser Supabase client authenticated with the current Clerk session token
// (Supabase Third-Party Auth). Used ONLY for Realtime chat subscriptions so a
// member receives live inserts for their own channels (RLS in migration 047).
// All actual chat reads/writes still go through the gated server APIs — this
// client never queries data directly. If Clerk↔Supabase third-party auth isn't
// configured, the token is simply rejected and Realtime stays quiet (the chat UI
// falls back to polling), so this is safe to ship ahead of the dashboard step.
//
// Realtime gets the same Clerk-only callback. supabase-js (2.118) would
// otherwise hand it the API key as the channel-join access_token whenever
// getToken() returns null; with no token, Realtime uses the connection's apikey.
export function createBrowserSupabase(getToken: () => Promise<string | null>): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabasePublicKey()
  if (!url || !key) throw new Error('Supabase public env vars not configured')
  const clerkToken = async () => (await getToken().catch(() => null)) ?? null
  return createClient(url, key, {
    accessToken: clerkToken,
    realtime: { params: { eventsPerSecond: 5 }, accessToken: clerkToken },
    global: { fetch: supabaseFetch },
  })
}

// Unauthenticated browser client used ONLY to PUT a file to a signed upload URL.
// The signed URL carries its own short-lived token, so no Clerk session is
// involved — this is what lets a large file go browser → storage directly,
// instead of through a route handler capped at 4.5MB by the platform.
export function createStorageUploadClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabasePublicKey()
  if (!url || !key) throw new Error('Supabase public env vars not configured')
  return createClient(url, key, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}
