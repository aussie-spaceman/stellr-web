'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { cn } from '@stellr/web-ui'

export type AdminSectionItem = { href: string; label: string; icon: LucideIcon; exact?: boolean }

/**
 * A section's own navigation inside the admin portal (Coaching, Mentoring).
 * From lg it is a 210px side column; below lg it is a row of pills that
 * scrolls sideways above the content, because a fixed side column left the
 * content about 100px wide on a phone.
 */
export function AdminSectionNav({
  heading,
  items,
  back,
}: {
  heading: string
  items: AdminSectionItem[]
  back: { href: string; label: string }
}) {
  const pathname = usePathname() ?? ''
  const active = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href))

  // Bring the current page's pill into view when the row is wider than the screen.
  const rowRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const current = rowRef.current?.querySelector<HTMLElement>('[aria-current="page"]')
    current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [pathname])

  return (
    <>
      {/* Phones and tablets */}
      <nav ref={rowRef} aria-label={heading} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] lg:hidden">
        <ul className="flex gap-2">
          {items.map(({ href, label, icon: Icon, exact }) => {
            const on = active(href, exact)
            return (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill border px-4 text-sm',
                    on
                      ? 'border-space-violet bg-space-violet-bg font-semibold text-space-violet-text'
                      : 'border-line bg-white text-content-secondary'
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden /> {label}
                </Link>
              </li>
            )
          })}
          <li className="shrink-0">
            <Link
              href={back.href}
              className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-pill border border-line bg-white px-4 text-sm text-content-secondary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden /> {back.label}
            </Link>
          </li>
        </ul>
      </nav>

      {/* Desktop */}
      <aside className="hidden w-[210px] shrink-0 lg:block">
        <p className="px-3 pb-2 font-subheading text-xs font-bold uppercase tracking-[0.08em] text-content-muted">{heading}</p>
        <nav aria-label={heading} className="flex flex-col gap-0.5">
          {items.map(({ href, label, icon: Icon, exact }) => {
            const on = active(href, exact)
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'flex min-h-10 items-center gap-2.5 rounded-control px-3 py-2 text-sm transition-colors',
                  on ? 'bg-space-violet-bg font-semibold text-space-violet-text' : 'text-content-secondary hover:bg-surface'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            )
          })}
        </nav>
        <p className="px-3 pb-2 pt-5 font-subheading text-xs font-bold uppercase tracking-[0.08em] text-content-muted">Other</p>
        <Link
          href={back.href}
          className="flex min-h-10 items-center gap-2.5 rounded-control px-3 py-2 text-sm text-content-secondary hover:bg-surface"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> {back.label}
        </Link>
      </aside>
    </>
  )
}
