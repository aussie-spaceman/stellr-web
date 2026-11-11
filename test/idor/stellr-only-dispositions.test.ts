// @vitest-environment node
//
// Every stellr_only id-bearing route has a place in the disposition register, and the
// tenant-destined count only falls. The register itself is proposed for the owner:
// lib/security/stellr-only-dispositions.ts.
import { describe, expect, it } from 'vitest'
import { idorTargets } from '@/lib/security/idor-targets'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { DISPOSITION_REGISTER_STATUS, STELLR_ONLY_DISPOSITIONS, dispositionCounts } from '@/lib/security/stellr-only-dispositions'

// Lower only: C16 to C21 take it to 0. It equals the register's count, so a conversion
// has to lower it and a route cannot be quietly moved into the bucket. The plan's 51 was
// measured before registrations/[id]/participants and registrations/[id]/payment-method
// existed. C16 moved 14 of its 15 to tenant_staff: event-managers keeps the Stellr admin
// guard until C21. C17 moved 17 more. registrations/[id]/payment-method (#573) arrived
// after C16, and its follow-up moved it. C18 moved companies, offerings and merch/commit.
const MAX_TENANT_DESTINED_STELLR_ONLY = 18

// platform_destined routes stay listed: the owner's choice for each is still to come.
const stellrOnly = idorTargets().filter((t) => t.cls === 'stellr_only' || t.cls === 'platform_destined').map((t) => t.file)

describe('stellr_only disposition register', () => {
  it('lists every stellr_only id-bearing route', () => {
    const unlisted = stellrOnly.filter((f) => !STELLR_ONLY_DISPOSITIONS[f])
    expect(unlisted, 'place these in lib/security/stellr-only-dispositions.ts').toEqual([])
  })

  it('lists nothing else: a converted or removed route leaves', () => {
    const stale = Object.keys(STELLR_ONLY_DISPOSITIONS).filter((f) => !stellrOnly.includes(f))
    expect(stale, 'remove these from lib/security/stellr-only-dispositions.ts').toEqual([])
  })

  it('the manifest class platform_destined and the register are the same routes', () => {
    const inManifest = Object.entries(ROUTE_MANIFEST).filter(([, c]) => c === 'platform_destined').map(([f]) => f).sort()
    const inRegister = Object.entries(STELLR_ONLY_DISPOSITIONS).filter(([, e]) => e.disposition === 'platform_destined').map(([f]) => f).sort()
    expect(inManifest).toEqual(inRegister)
  })

  it('holds the tenant-destined count at its cap', () => {
    expect(dispositionCounts().tenant_destined).toBe(MAX_TENANT_DESTINED_STELLR_ONLY)
  })

  it('gives every entry a reason', () => {
    for (const [f, e] of Object.entries(STELLR_ONLY_DISPOSITIONS)) expect(e.reason.length, f).toBeGreaterThan(15)
  })

  it('says whether the owner has approved it, with the date if so', () => {
    const { status, approvedOn } = DISPOSITION_REGISTER_STATUS
    if (status === 'proposed') expect(approvedOn).toBeNull()
    else expect(approvedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('counts by disposition', () => {
    const counts = dispositionCounts({
      a: { disposition: 'permanent', reason: 'x' },
      b: { disposition: 'permanent', reason: 'x' },
      c: { disposition: 'tenant_destined', reason: 'x' },
    })
    expect(counts).toEqual({ tenant_destined: 1, platform_destined: 0, permanent: 2, until_s7_identity: 0 })
  })
})
