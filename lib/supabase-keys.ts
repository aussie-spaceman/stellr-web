// Which Supabase API key this process holds, and how to send it.
//
// WHY (S0, Nov 2026): Supabase has deprecated the JWT-based `anon` and
// `service_role` keys; they stop working at the end of 2026. Their replacements
// are the publishable key (`sb_publishable_…`, same low privilege as anon) and
// secret keys (`sb_secret_…`, same elevated privilege as service_role). The new
// keys are NOT JWTs, so they travel on the `apikey` header only, never on
// `Authorization: Bearer` (Supabase: "Migrating to publishable and secret API
// keys", Known limitations). The owner steps for the switch are in
// docs/RUNBOOK-supabase-api-keys.md.
//
// Every reader of a Supabase key goes through this module, so a deployment can
// move to the new keys by setting the new variables, and back by unsetting them:
//
//   public (browser-safe)   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//                           falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY (legacy)
//   elevated (server only)  SUPABASE_SECRET_KEY
//                           falls back to SUPABASE_SERVICE_ROLE_KEY (legacy)
//
// Either key format works under either name, so nothing here depends on a key
// being a JWT. An empty variable counts as unset: GitHub Actions turns a missing
// secret into an empty string, and that must not mask the legacy fallback.
//
// No dependencies, on purpose: proxy.ts (via lib/crawlers.ts), the browser
// client, scripts and e2e fixtures all import it. scripts/verify-deletion-
// registry.mjs imports it in plain Node, which strips the types, so keep to
// erasable TypeScript (no enums, namespaces or constructor parameter
// properties; its test fails otherwise). Read at call time, never at module
// load, because scripts load .env.local after their imports run.
//
// Nothing here returns a key in an error or a status. Kinds, roles and variable
// names are safe to show an admin; values never are.

export type SupabaseKeyKind = 'publishable' | 'secret' | 'legacy-jwt' | 'unrecognised'

export const PUBLIC_KEY_VARS = 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)'
export const SECRET_KEY_VARS = 'SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)'

/**
 * The format of a key, from its prefix and shape alone (no decoding). A legacy
 * key is a JWT: three base64url segments whose header starts `eyJ` (`{"`).
 * 'unrecognised' covers placeholders (CI builds) and any future `sb_` subtype.
 */
export function supabaseKeyKind(key: string): SupabaseKeyKind {
  if (key.startsWith('sb_publishable_')) return 'publishable'
  if (key.startsWith('sb_secret_')) return 'secret'
  if (/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key)) return 'legacy-jwt'
  return 'unrecognised'
}

/**
 * The Postgres role a key acts as, or null when that cannot be told. The new
 * formats say it in the prefix. A legacy key says it in its `role` claim, read
 * here WITHOUT verifying the signature: only to catch the anon and
 * service_role JWTs swapped between slots, which look identical by prefix.
 * Nothing else reads it, and a key that is not a JWT never gets here.
 * Never throws.
 */
export function supabaseKeyRole(key: string): string | null {
  const kind = supabaseKeyKind(key)
  if (kind === 'publishable') return 'anon'
  if (kind === 'secret') return 'service_role'
  if (kind !== 'legacy-jwt') return null
  try {
    const segment = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims: unknown = JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, '=')))
    const role = (claims as { role?: unknown } | null)?.role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

type Picked = { name: string; key: string }

function pick(primary: [string, string | undefined], legacy: [string, string | undefined]): Picked | null {
  for (const [name, raw] of [primary, legacy]) {
    // Trimmed: a value pasted into a dashboard with a trailing newline is the
    // commonest way a correct key gets rejected.
    const key = raw?.trim()
    if (key) return { name, key }
  }
  return null
}

// The process.env.NEXT_PUBLIC_* reads must stay literal. Next inlines only
// literal references into the browser bundle; a computed name is undefined there.
function pickPublic(): Picked | null {
  return pick(
    ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY],
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
  )
}

function pickSecret(): Picked | null {
  return pick(
    ['SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY],
    ['SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY],
  )
}

/** 'secret', 'publishable', or 'legacy anon' / 'legacy service_role': for messages. */
function describeKey(key: string, role: string): string {
  const kind = supabaseKeyKind(key)
  return kind === 'legacy-jwt' ? `legacy ${role}` : kind
}

export class SupabaseKeySlotError extends Error {
  constructor(variable: string, held: string, expected: string) {
    super(
      `${variable} holds a Supabase ${held} key, but it must hold ${expected}. ` +
      'See docs/RUNBOOK-supabase-api-keys.md.',
    )
    this.name = 'SupabaseKeySlotError'
  }
}

/**
 * The low-privilege key (publishable, or legacy anon), or undefined when unset.
 *
 * Throws when the variable holds an elevated key (a secret key, or the legacy
 * service_role JWT): a NEXT_PUBLIC_ value ships in the browser bundle, so that
 * key must be treated as leaked and rotated. next.config.mjs refuses to build in
 * that state; this catches the runtime too.
 */
export function supabasePublicKey(): string | undefined {
  const picked = pickPublic()
  if (!picked) return undefined
  const role = supabaseKeyRole(picked.key)
  if (role === 'service_role') {
    throw new SupabaseKeySlotError(picked.name, describeKey(picked.key, role), 'the publishable key')
  }
  return picked.key
}

/**
 * The elevated key (secret, or legacy service_role), or undefined when unset.
 * Server code and scripts only.
 *
 * Throws when the variable holds a low-privilege key (the publishable key, or
 * the legacy anon JWT). That client would run as `anon` instead of bypassing
 * RLS: some reads would quietly come back empty and some writes would quietly
 * fail, which is much harder to spot than an error.
 */
export function supabaseSecretKey(): string | undefined {
  const picked = pickSecret()
  if (!picked) return undefined
  const role = supabaseKeyRole(picked.key)
  if (role === 'anon') {
    throw new SupabaseKeySlotError(picked.name, describeKey(picked.key, role), 'a secret key')
  }
  return picked.key
}

/**
 * Headers for a raw fetch to the Supabase API (PostgREST, Storage), for callers
 * that do not use supabase-js. The key always goes on `apikey`. It goes on
 * `Authorization: Bearer` too only when it is a legacy JWT, which is how those
 * calls always worked. A publishable or secret key is not a JWT; with `apikey`
 * alone the gateway supplies the role itself.
 */
export function supabaseApiHeaders(key: string): Record<string, string> {
  return supabaseKeyKind(key) === 'legacy-jwt'
    ? { apikey: key, Authorization: `Bearer ${key}` }
    : { apikey: key }
}

/**
 * The fetch every supabase-js client in this repo is given (`global.fetch`).
 *
 * With no user session, supabase-js repeats its key on `Authorization: Bearer`
 * for REST, Storage and Auth calls (2.118 omits it for Functions only). For a
 * publishable or secret key this drops that copy, so the key travels on
 * `apikey` alone. Anything else passes through untouched: a legacy JWT key
 * (sent on both headers, as always) and a real user token such as the Clerk
 * session token, which never equals `apikey`.
 */
export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (init?.headers) {
    const headers = new Headers(init.headers)
    const apikey = headers.get('apikey')
    const kind = apikey ? supabaseKeyKind(apikey) : null
    if ((kind === 'publishable' || kind === 'secret') && headers.get('Authorization') === `Bearer ${apikey}`) {
      headers.delete('Authorization')
      return fetch(input, { ...init, headers })
    }
  }
  return fetch(input, init)
}

export type SupabaseKeySlot = {
  /** The variable the key was read from, or null when neither is set. */
  variable: string | null
  kind: SupabaseKeyKind | 'unconfigured'
  /** The role the key acts as ('anon' | 'service_role' | …), or null when unknown. */
  role: string | null
}

/**
 * What this deployment holds in each slot: kind, role and variable name, never
 * the value. Lets the owner confirm, from inside a deployment, that it runs on
 * the new keys before the legacy ones are disabled (`vercel env pull` redacts
 * secrets, so nothing outside the deployment can tell), and that the public
 * slot says `anon` and the secret slot `service_role`. Never throws.
 */
export function supabaseKeySlots(): { public: SupabaseKeySlot; secret: SupabaseKeySlot } {
  const describe = (picked: Picked | null): SupabaseKeySlot =>
    picked
      ? { variable: picked.name, kind: supabaseKeyKind(picked.key), role: supabaseKeyRole(picked.key) }
      : { variable: null, kind: 'unconfigured', role: null }
  return { public: describe(pickPublic()), secret: describe(pickSecret()) }
}
