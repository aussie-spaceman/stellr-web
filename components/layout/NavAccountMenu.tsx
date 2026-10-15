'use client'

import { Component, type ReactNode } from 'react'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance } from '@/lib/clerk-appearance'
import { NavUserButton } from './NavUserButton'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

/**
 * Clerk is loaded here, from its CDN, only for a visitor who looks signed in.
 * If it fails, the header keeps the "My Stellr" link and loses the avatar; it
 * must never take the page down with it.
 */
class AvatarBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn('[nav] account menu unavailable', error)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The signed-in account links for the public header. Loaded on demand by
 * Navbar, only when the browser has a Clerk session hint, and brings its own
 * ClerkProvider: the public site has no app-wide one, so anonymous visitors
 * download no Clerk code.
 *
 * Not `prefetchUI={false}`: that leaves out Clerk's prebuilt components, and
 * the avatar is one (UserButton). Without them it throws on mount.
 */
export default function NavAccountMenu() {
  return (
    <>
      <a href={`${AUTH_URL}/community`} className="inline-flex min-h-6 items-center text-sm text-hero-lead transition-colors hover:text-white">
        My Stellr
      </a>
      <AvatarBoundary>
        <ClerkProvider appearance={clerkAppearance}>
          <NavUserButton />
        </ClerkProvider>
      </AvatarBoundary>
    </>
  )
}
