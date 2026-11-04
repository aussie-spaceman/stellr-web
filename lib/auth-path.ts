import { safeNext } from '@/lib/safe-next'

// Where a guest goes when a page needs them signed in. Anyone can create an
// account (decision 24, 3 Nov 2026), so both doors stay open:
//
// - 'sign-in' (the default) for member pages a returning member is most likely
//   after. Clerk's sign-in card shows "Don't have an account? Sign up", and that
//   link carries the same ?next, so a newcomer is one click from registering.
// - 'sign-up' for pages meant for new members (/join, mentoring discovery, the
//   academy coaching intake). Clerk's sign-up card links back to sign-in.
//
// Both carry ?next so the guest lands back where they were. The auth pages
// validate ?next again with safeNext; this drops an unsafe one here too, so a
// bad path never reaches the URL at all.
//
// Pure (no server imports), so client components can use it as well.
export type AuthMode = 'sign-in' | 'sign-up'

export function authPath(next?: string | null, mode: AuthMode = 'sign-in'): string {
  const base = mode === 'sign-up' ? '/sign-up' : '/sign-in'
  const safe = safeNext(next)
  return safe ? `${base}?next=${encodeURIComponent(safe)}` : base
}
