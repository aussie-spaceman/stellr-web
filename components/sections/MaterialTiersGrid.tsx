import { CheckCircle } from 'lucide-react'
import { MATERIAL_TIERS } from '@/lib/material-tiers'

interface Props {
  /** Tinted per-tier card backgrounds (activities page) vs plain bordered cards (competitions page). */
  tinted?: boolean
}

export function MaterialTiersGrid({ tinted = false }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {MATERIAL_TIERS.map((tier) => (
        <div
          key={tier.tier}
          className={`border rounded-xl p-6 flex flex-col gap-4 ${tinted ? tier.cardClass : 'border-gray-200'}`}
        >
          <div>
            <span
              className={`inline-block text-xs font-semibold px-2 py-1 rounded-full ${tier.badgeClass} mb-3`}
            >
              {tier.access}
            </span>
            <h3 className="font-bold text-brand-blue-dark">{tier.tier}</h3>
          </div>
          <ul className="space-y-2 flex-1">
            {tier.items.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-brand-grey-dark">
                <CheckCircle size={14} className="text-brand-blue shrink-0 mt-0.5" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
