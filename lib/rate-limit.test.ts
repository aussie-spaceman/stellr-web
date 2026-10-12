import { describe, it, expect } from 'vitest'
import { checkRateLimit } from './rate-limit'

// deep review AUTH-4: the in-memory limiter used to `buckets.clear()` on overflow,
// wiping EVERY live window — so a client spraying distinct keys (one per IP from a
// proxy pool) could reset everyone's limit, including an already-throttled key.
// Overflow must now shed entries instead of wiping, leaving live windows intact.

const MAX_KEYS = 10_000

describe('checkRateLimit overflow eviction', () => {
  it('does not reset a live, already-throttled key when the map overflows', () => {
    const win = { limit: 1, windowMs: 60_000 }

    // Fill the map to the cap with unrelated live keys FIRST, so the victim we add
    // next is the newest entry — the oldest-entry fallback sheds spam, never it.
    for (let i = 0; i < MAX_KEYS; i++) {
      checkRateLimit(`spam-${i}`, { limit: 5, windowMs: 60_000 })
    }

    // Throttle the victim: first call allowed, second over the limit. The second
    // call pushes the map over the cap and triggers eviction.
    expect(checkRateLimit('victim', win).ok).toBe(true)

    // Under the old clear()-on-overflow, this call would have wiped the whole map
    // (victim included) and come back as a fresh, allowed first-touch. With
    // eviction the victim's live window survives and it stays throttled.
    expect(checkRateLimit('victim', win).ok).toBe(false)
    // And still throttled on a subsequent overflow-triggering call.
    expect(checkRateLimit('victim', win).ok).toBe(false)
  })
})
