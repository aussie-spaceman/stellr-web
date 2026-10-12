import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)')
  return createClient(url, key)
}

export const supabase = getSupabaseClient

export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase server env vars not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) throw new Error('Supabase server env vars not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)')
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false },
  })
}
