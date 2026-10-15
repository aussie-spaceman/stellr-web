'use client'

import { Button } from '@stellr/web-ui'
import { useMemberCampaigns } from './useMemberCampaigns'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'

/**
 * The parts of the campaign views that depend on who is looking. The pages
 * render for an anonymous visitor (so they can be cached) and these update in
 * the browser for a signed-in member. `registered` / `membership` props are the
 * starting values (tests and any server caller can still pass them).
 */

function useRegistered(slug: string, initial: boolean) {
  const ctx = useMemberCampaigns()
  return ctx ? ctx.registeredSlugs.includes(slug) : initial
}

/** "Compete Now" for a campaign, or "Access Campaign" for a member already in. */
export function CampaignCta({
  slug,
  isOpen,
  closedNote,
  registered: initialRegistered = false,
  className,
  closedClassName,
}: {
  slug: string
  isOpen: boolean
  closedNote: string
  registered?: boolean
  className?: string
  closedClassName?: string
}) {
  const registered = useRegistered(slug, initialRegistered)
  // A member who is already in keeps their way back in whatever the
  // registration window is doing.
  if (!registered && !isOpen) return <p className={closedClassName}>{closedNote}</p>
  return (
    <Button href={registered ? `${APP_URL}/events` : `/register/${slug}/group`} variant="primaryStrong" className={className}>
      {registered ? 'Access Campaign →' : 'Compete Now →'}
    </Button>
  )
}

/** The green note in the campaign's info card. */
export function CampaignMembershipNote({
  membership: initial = null,
  className,
}: {
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
  className?: string
}) {
  const ctx = useMemberCampaigns()
  const membership = ctx?.membership ?? initial
  return membership?.schoolName ? (
    <p className={className}>
      Signed in as <strong>{membership.schoolName}</strong>
      {membership.roleLabel ? ` · ${membership.roleLabel}` : ''} — no payment needed.
    </p>
  ) : (
    <p className={className}>Free — no payment required for Campaigns.</p>
  )
}

/** A campaign card's action: "Registered" or "Register group". */
export function CampaignCardAction({ slug, registered: initialRegistered = false }: { slug: string; registered?: boolean }) {
  const registered = useRegistered(slug, initialRegistered)
  return registered ? (
    <span className="rounded-pill bg-enviro-green-bg px-3 py-1 text-xs font-semibold text-enviro-green-text">Registered</span>
  ) : (
    <Button href={`/register/${slug}/group`} variant="primaryStrong" className="!px-4 !py-2 text-sm">
      Register group →
    </Button>
  )
}
