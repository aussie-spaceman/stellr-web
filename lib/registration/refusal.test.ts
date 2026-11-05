import { describe, it, expect } from 'vitest'
import { ageRefused, refuse, temporarilyUnavailable } from './refusal'

describe('lib/registration/refusal', () => {
  it('refuse carries the answer it is given', () => {
    const response = new Response(null, { status: 418 })
    expect(refuse(response)).toEqual({ ok: false, response })
  })

  it('temporarilyUnavailable is the retryable 503', async () => {
    const res = temporarilyUnavailable()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Registration is temporarily unavailable. Please try again shortly.' })
  })

  it('ageRefused is a 400 with the check’s reason as the code and its words as the error', async () => {
    const res = ageRefused({ reason: 'dob_invalid', error: 'No.' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ code: 'dob_invalid', error: 'No.' })
  })
})
