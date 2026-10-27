'use client'

import { CalendarClock } from 'lucide-react'
import { Button, type ButtonVariant } from '@stellr/web-ui'
import { pushDataLayer } from '@/lib/analytics'
import { INTRO_CALL_URL, type BookingLocation } from '@/lib/booking'

/**
 * "Book a 15-min call" — the secondary action beside a page's main one. Opens
 * the Motion booking page in a new tab and reports which button was used
 * (`booking_click`; no PII). A click is a hand-off, not a booking: the
 * motion-bookings cron records the booking itself.
 */
export function BookCallButton({
  location,
  variant = 'secondary',
  className,
  children = 'Book a 15-min call',
}: {
  location: BookingLocation
  variant?: ButtonVariant
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Button
      href={INTRO_CALL_URL}
      target="_blank"
      rel="noopener noreferrer"
      variant={variant}
      className={className}
      onClick={() => pushDataLayer({ event: 'booking_click', location })}
    >
      <CalendarClock size={16} aria-hidden="true" />
      {children}
      <span className="sr-only">{' (opens in a new tab)'}</span>
    </Button>
  )
}
