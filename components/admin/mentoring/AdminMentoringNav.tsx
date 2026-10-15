'use client'

import { Users, CalendarDays, ShieldCheck } from 'lucide-react'
import { AdminSectionNav, type AdminSectionItem } from '@/components/admin/AdminSectionNav'

const ITEMS: AdminSectionItem[] = [
  { href: '/admin/academy/mentoring', label: 'Cohorts', icon: Users, exact: true },
  { href: '/admin/academy/mentoring/calendar', label: 'Sessions calendar', icon: CalendarDays },
  { href: '/admin/academy/mentoring/membership', label: 'Membership & access', icon: ShieldCheck },
]

export function AdminMentoringNav() {
  return <AdminSectionNav heading="Admin · Community" items={ITEMS} back={{ href: '/community/mentoring', label: 'Back to app' }} />
}
