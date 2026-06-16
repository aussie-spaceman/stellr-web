import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Browser Supabase client authenticated with the current Clerk session token
// (Supabase Third-Party Auth). Used ONLY for Realtime chat subscriptions so a
// member receives live inserts for their own channels (RLS in migration 047).
// All actual chat reads/writes still go through the gated server APIs — this
// client never queries data directly. If Clerk↔Supabase third-party auth isn't
// configured, the token is simply rejected and Realtime stays quiet (the chat UI
// falls back to polling), so this is safe to ship ahead of the dashboard step.
export function createBrowserSupabase(getToken: () => Promise<string | null>): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase public env vars not configured')
  return createClient(url, key, {
    accessToken: async () => (await getToken().catch(() => null)) ?? null,
    realtime: { params: { eventsPerSecond: 5 } },
  })
}
