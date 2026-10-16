'use client'

import { useEffect, useState } from 'react'
import { hasSessionHint } from '@/lib/session-hint'

export type MemberCampaigns = {
  registeredSlugs: string[]
  membership: { schoolName?: string | null; roleLabel?: string | null } | null
}

// One request per page, however many cards ask (a promise on globalThis, as
// useMemberPrefill does, because consumers can live in separate chunks).
const KEY = '__stellrMemberCampaigns'
type G = typeof globalThis & { [KEY]?: Promise<MemberCampaigns | null> }

function load(): Promise<MemberCampaigns | null> {
  if (!hasSessionHint()) return Promise.resolve(null)
  const g = globalThis as G
  g[KEY] ??= fetch('/api/members/me/campaign-context', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<MemberCampaigns>) : null))
    .catch(() => null)
  return g[KEY]
}

/** Reset between tests; not used by application code. */
export function __resetMemberCampaigns() {
  delete (globalThis as G)[KEY]
}

/**
 * The signed-in member's campaign registrations, fetched in the browser after
 * the page loads (null while loading, and for anonymous visitors, who make no
 * request). Lets the public event pages stay static.
 */
export function useMemberCampaigns(): MemberCampaigns | null {
  const [state, setState] = useState<MemberCampaigns | null>(null)
  useEffect(() => {
    let live = true
    load().then((v) => live && setState(v))
    return () => {
      live = false
    }
  }, [])
  return state
}
