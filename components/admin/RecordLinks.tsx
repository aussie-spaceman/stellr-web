'use client'

import { createContext, useContext, type ReactNode } from 'react'

// Person and school names in the admin portal link to their records, so an
// admin working down a roster can open a student or school without searching.
//
// Admins only. Member and school records are admin pages (event managers are
// redirected off them by proxy.ts), and a member record holds a minor's data
// across every event, so an event manager sees the plain name. The admin
// layout sets `enabled` from the viewer's role; nothing else needs to.
//
// Links open in a new tab, so the roster keeps its filters, folds and scroll.
// With no id (no member behind the row, or no school we can match exactly)
// the name renders as plain text: no link beats a wrong link.

const RecordLinksContext = createContext(false)

export function RecordLinksProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <RecordLinksContext.Provider value={enabled}>{children}</RecordLinksContext.Provider>
}

export function useRecordLinks(): boolean {
  return useContext(RecordLinksContext)
}

const LINK = 'text-primary underline-offset-2 hover:underline focus-visible:underline'

function RecordLink({
  href,
  children,
  className,
  title,
}: {
  href: string | null
  children: ReactNode
  className?: string
  title?: string
}) {
  const enabled = useRecordLinks()
  if (!enabled || !href) return <span className={className}>{children}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      title={title}
      className={className ? `${className} ${LINK}` : LINK}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

/** A person's name, linked to /admin/members/[id] for admins. */
export function MemberLink({
  memberId,
  children,
  className,
}: {
  memberId: string | null | undefined
  children: ReactNode
  className?: string
}) {
  return (
    <RecordLink href={memberId ? `/admin/members/${memberId}` : null} className={className} title="Open member record">
      {children}
    </RecordLink>
  )
}

/** A school name, linked to /admin/schools/[id] for admins. */
export function SchoolLink({
  schoolId,
  children,
  className,
}: {
  schoolId: string | null | undefined
  children: ReactNode
  className?: string
}) {
  return (
    <RecordLink href={schoolId ? `/admin/schools/${schoolId}` : null} className={className} title="Open school record">
      {children}
    </RecordLink>
  )
}
