'use client'

import { useEffect, useRef, useState } from 'react'
import type { FieldValues, UseFormReset } from 'react-hook-form'

export interface MemberPrefill {
  firstName: string
  lastName: string
  email: string
  phone: string
  schoolName: string
}

/** Empty object = signed out, or nothing on file. */
type PrefillResponse = Partial<MemberPrefill>

// One request per page, shared by every form on it. A page can easily carry
// three of these — an asset gate, the notify modal, and the footer subscribe
// box — and StrictMode double-mounts every one of them in development.
//
// The promise is parked on globalThis rather than in a module-scoped `let`
// because the consumers live in different client chunks: the footer and a page
// form can each get their own instance of this module, and two module instances
// mean two module-scoped caches and two identical requests. Observed doing
// exactly that on /contact.
const CACHE_KEY = '__stellrMemberPrefill'

type PrefillGlobal = typeof globalThis & { [CACHE_KEY]?: Promise<PrefillResponse> }

function loadPrefill(): Promise<PrefillResponse> {
  const g = globalThis as PrefillGlobal
  if (!g[CACHE_KEY]) {
    g[CACHE_KEY] = fetch('/api/members/me/prefill', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}))
  }
  return g[CACHE_KEY]
}

/** Reset between tests; not used by application code. */
export function __resetMemberPrefillCache(): void {
  delete (globalThis as PrefillGlobal)[CACHE_KEY]
}

/**
 * The signed-in member's contact details, or null.
 *
 * `loaded` distinguishes "still fetching" from "fetched, and there was nothing"
 * — callers need that to avoid resetting a form the visitor has already started
 * typing into. The fields arrive after first paint by design; every caller must
 * merge them in a way that never clobbers user input (react-hook-form's
 * `reset(..., { keepDirtyValues: true })`, or an explicit "only if empty" fill).
 */
export function useMemberPrefill(): { prefill: MemberPrefill | null; loaded: boolean } {
  const [state, setState] = useState<{ prefill: MemberPrefill | null; loaded: boolean }>({
    prefill: null,
    loaded: false,
  })

  useEffect(() => {
    let active = true
    loadPrefill().then((data) => {
      if (!active) return
      const hasSomething = Boolean(data.email || data.firstName || data.lastName)
      setState({
        prefill: hasSomething
          ? {
              firstName: data.firstName ?? '',
              lastName: data.lastName ?? '',
              email: data.email ?? '',
              phone: data.phone ?? '',
              schoolName: data.schoolName ?? '',
            }
          : null,
        loaded: true,
      })
    })
    return () => {
      active = false
    }
  }, [])

  return state
}

/**
 * Seed a react-hook-form with the signed-in member's details.
 *
 * `keepDirtyValues` is the whole point: the prefill lands after first paint, so
 * a fast typist can already be three fields in when it arrives. Without it, the
 * reset would wipe what they just typed — a worse bug than no prefill at all.
 */
export function usePrefillForm<T extends FieldValues>(
  reset: UseFormReset<T>,
  map: (prefill: MemberPrefill) => Partial<T>,
): { prefill: MemberPrefill | null; loaded: boolean } {
  const { prefill, loaded } = useMemberPrefill()

  // The mapper is written inline at every call site, so it is a new function on
  // every render — hold it in a ref rather than making it an effect dependency.
  const mapRef = useRef(map)
  mapRef.current = map

  useEffect(() => {
    if (!loaded || !prefill) return
    reset((current) => ({ ...current, ...mapRef.current(prefill) }), { keepDirtyValues: true })
  }, [loaded, prefill, reset])

  return { prefill, loaded }
}

/**
 * Seed plain `useState` fields from the signed-in member's record.
 *
 * Only fills a field that is still empty, which is the useState equivalent of
 * react-hook-form's `keepDirtyValues`: the prefill lands after first paint, and
 * a visitor who has already typed must keep what they typed. Setters are read
 * through a ref so callers can pass them inline without stabilising anything.
 */
export function usePrefillFields(
  fields: Partial<Record<keyof MemberPrefill, [string, (v: string) => void]>>,
): { prefill: MemberPrefill | null; loaded: boolean } {
  const { prefill, loaded } = useMemberPrefill()

  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  useEffect(() => {
    if (!loaded || !prefill) return
    for (const [key, pair] of Object.entries(fieldsRef.current)) {
      if (!pair) continue
      const [current, setter] = pair
      const value = prefill[key as keyof MemberPrefill]
      if (!current.trim() && value) setter(value)
    }
  }, [loaded, prefill])

  return { prefill, loaded }
}

/** Full name from the prefill, for forms with a single "name" field. */
export function prefillFullName(p: MemberPrefill): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ')
}

/**
 * The name+email pair the gated-download modals and the event notify modal all
 * collect. They keep a single `name` field rather than first/last, so they
 * can't use usePrefillFields' key mapping directly.
 */
export function usePrefillNameEmail(
  name: string,
  setName: (v: string) => void,
  email: string,
  setEmail: (v: string) => void,
): { prefill: MemberPrefill | null; loaded: boolean } {
  const { prefill, loaded } = useMemberPrefill()

  const ref = useRef({ name, setName, email, setEmail })
  ref.current = { name, setName, email, setEmail }

  useEffect(() => {
    if (!loaded || !prefill) return
    const c = ref.current
    const full = prefillFullName(prefill)
    if (full && !c.name.trim()) c.setName(full)
    if (prefill.email && !c.email.trim()) c.setEmail(prefill.email)
  }, [loaded, prefill])

  return { prefill, loaded }
}
