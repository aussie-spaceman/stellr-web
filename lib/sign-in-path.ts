import { safeNext } from '@/lib/safe-next'

// Where a guest goes when a member-only page needs them signed in (3 Nov 2026).
// Sign-up is invite-only (Clerk Restricted mode): /sign-up only works from a
// Clerk invitation link, so sending a guest there shows them a dead end. Every
// guest bounce goes to /sign-in instead, carrying ?next so they land back where
// they were. The sign-in page validates ?next again with safeNext; this drops an
// unsafe one here too, so a bad path never reaches the URL at all.
//
// Pure (no server imports), so client components can use it as well.
export function signInPath(next?: string | null): string {
  const safe = safeNext(next)
  return safe ? `/sign-in?next=${encodeURIComponent(safe)}` : '/sign-in'
}
