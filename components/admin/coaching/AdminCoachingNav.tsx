'use client'

import { Star, CalendarDays, ShieldCheck, Inbox } from 'lucide-react'
import { AdminSectionNav, type AdminSectionItem } from '@/components/admin/AdminSectionNav'

const ITEMS: AdminSectionItem[] = [
  { href: '/admin/academy/coaching', label: 'Coaching workshops', icon: Star, exact: true },
  { href: '/admin/academy/coaching/requests', label: 'Coaching requests', icon: Inbox },
  { href: '/admin/academy/coaching/calendar', label: 'Sessions calendar', icon: CalendarDays },
  { href: '/admin/academy/coaching/access', label: 'Membership & access', icon: ShieldCheck },
]

export function AdminCoachingNav() {
  return <AdminSectionNav heading="Admin · Coaching" items={ITEMS} back={{ href: '/community/coaching', label: 'Back to app' }} />
}
