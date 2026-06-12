// Pure-function checks for the refund compute logic (no DB/Stripe/network).
// Run: npx tsx scripts/test-refund-policy.ts
import { DEFAULT_TIERS, applicableTier, computeRefundOptions, daysOut } from '../lib/refunds/policy'

let failures = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✓' : '✗'} ${name}`)
  if (!cond) failures++
}

const now = new Date('2026-01-01T00:00:00Z')
const eventAt = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString()
const paid = 10000 // $100.00

// daysOut floors correctly
check('daysOut 120', daysOut(eventAt(120), now) === 120)
check('daysOut same-day = 0', daysOut(eventAt(0), now) === 0)

// 120 days out → tier 90: 100% cash, no credit
const t120 = applicableTier(DEFAULT_TIERS, eventAt(120), now)
const o120 = computeRefundOptions(t120, paid)
check('120d → cash 100% = 10000', o120.cash?.cents === 10000 && o120.cash?.pct === 100)
check('120d → no credit', !o120.credit)

// 60 days out → tier 30: 50% cash OR 75% credit (730d)
const o60 = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(60), now), paid)
check('60d → cash 50% = 5000', o60.cash?.cents === 5000)
check('60d → credit 75% = 7500, 730d', o60.credit?.cents === 7500 && o60.credit?.validityDays === 730)

// 20 days out → tier 14: 33% cash OR 50% credit
const o20 = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(20), now), paid)
check('20d → cash 33% = 3300', o20.cash?.cents === 3300)
check('20d → credit 50% = 5000', o20.credit?.cents === 5000)

// 5 days out → tier 0: credit 25% only, no cash
const o5 = computeRefundOptions(applicableTier(DEFAULT_TIERS, eventAt(5), now), paid)
check('5d → no cash', !o5.cash)
check('5d → credit 25% = 2500', o5.credit?.cents === 2500)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
