import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { PUBLIC_KEY_VARS, SECRET_KEY_VARS, supabaseFetch, supabasePublicKey, supabaseSecretKey } from '@/lib/supabase-keys'

// Keys come from lib/supabase-keys.ts, which reads the publishable/secret
// variables only (the legacy-name fallback was removed 3 Nov 2026). supabaseFetch
// keeps a publishable or secret key off `Authorization: Bearer` (supabase-js
// would repeat it there); a legacy JWT key goes out exactly as it always has.

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = supabasePublicKey()
  if (!url || !key) throw new Error(`Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL, ${PUBLIC_KEY_VARS})`)
  return createClient(url, key, { global: { fetch: supabaseFetch } })
}

export const supabase = getSupabaseClient

function serverEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = supabaseSecretKey()
  if (!url || !secretKey) throw new Error(`Supabase server env vars not configured (NEXT_PUBLIC_SUPABASE_URL, ${SECRET_KEY_VARS})`)
  return { url, secretKey }
}

export function supabaseServer() {
  const { url, secretKey } = serverEnv()
  return createClient(url, secretKey, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  })
}

// deep review QUAL-4: the client above is untyped, so a renamed/dropped column,
// a wrong enum literal, or a write to a column that does not exist compiles and
// fails only at runtime. This variant applies the `Database` generic so those
// are compile errors on the tables the generic covers — today the hand-written
// registration/participant schema in lib/database.types.ts. New or hot code
// (registration, e-sign, members) can opt in by calling this instead of
// supabaseServer(); it is NOT swapped into the ~650 existing call sites, which
// is a separate follow-up (see the PR notes). FLAG: the full fix is to generate
// lib/database.types.ts for every table with `supabase gen types` and thread
// the generic through; that needs DB access this change does not have.
export function supabaseServerTyped() {
  const { url, secretKey } = serverEnv()
  return createClient<Database>(url, secretKey, {
    auth: { persistSession: false },
    global: { fetch: supabaseFetch },
  })
}
