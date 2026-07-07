import Link from 'next/link'

export type MembershipTab = 'tiers' | 'rules' | 'discounts'

// Tab strip for the Membership Studio. All four views live on /admin/membership
// and are addressed by ?tab= (tiers is the default), so this is a plain server
// component — no pathname sniffing needed.
const TABS: { value: MembershipTab; label: string }[] = [
  { value: 'tiers', label: 'Tiers' },
  { value: 'rules', label: 'Grant rules' },
  { value: 'discounts', label: 'Discounts' },
]

export function MembershipNav({ active }: { active: MembershipTab }) {
  return (
    <div className="flex gap-1 border-b border-brand-border mb-6 text-sm">
      {TABS.map((t) => (
        <Link
          key={t.value}
          href={t.value === 'tiers' ? '/admin/membership' : `/admin/membership?tab=${t.value}`}
          className={
            'px-4 py-2 -mb-px border-b-2 ' +
            (active === t.value
              ? 'border-brand-blue text-brand-blue-dark font-medium'
              : 'border-transparent text-brand-muted-soft hover:text-brand-blue-dark')
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
