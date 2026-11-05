// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pushDataLayer, trackingAllowedHere } from '@/lib/analytics'

// There is no window here, as on the server. The root layout is prerendered, so
// this answer decides what every Stellr page sends: it must be the Stellr markup.
describe('with no window', () => {
  it('leaves the decision to the browser', () => {
    expect(typeof window).toBe('undefined')
    expect(trackingAllowedHere()).toBe(true)
  })

  it('pushDataLayer does nothing', () => {
    expect(() => pushDataLayer({ event: 'page' })).not.toThrow()
  })
})
