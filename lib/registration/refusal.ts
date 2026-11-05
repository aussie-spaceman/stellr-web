import { NextResponse } from 'next/server'

// What the split register routes share: a step either hands its result on or
// answers the request itself.

/** A step's outcome: what it established, or the answer that ends the request. */
export type Refusable<T> = ({ ok: true } & T) | { ok: false; response: Response }

export const refuse = (response: Response): { ok: false; response: Response } => ({ ok: false, response })

/** The retryable answer when a read fails or a service is down. Nothing was decided about this person. */
export const temporarilyUnavailable = (): Response =>
  NextResponse.json(
    { error: 'Registration is temporarily unavailable. Please try again shortly.' },
    { status: 503 },
  )

/** A date of birth the person just typed, refused in checkRegistrationAge's own words. */
export const ageRefused = (check: { reason: string; error: string }): Response =>
  NextResponse.json({ code: check.reason, error: check.error }, { status: 400 })
