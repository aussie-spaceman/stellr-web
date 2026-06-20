'use client'

import { useState } from 'react'

const faqs = [
  {
    q: 'How do I join Stellr?',
    a: "Create a free account and you're in the base free tier — no payment needed. School students aged 14–18 join as Explorer; college and university students join as Alumni; educators join as Educator. All three base tiers are free and give you full access to community spaces, training materials, and competition entry.",
  },
  {
    q: 'Can I buy Pathfinder or Scholar directly?',
    a: 'Yes — all paid tiers can be purchased directly, for members looking to improve their STEM skills. Competition participants can also access paid tiers through attendance.',
  },
  {
    q: 'What happens when my tier expires?',
    a: 'Your account moves back to the free base tier. You can always keep your tier by participating in another competition or purchasing the membership.',
  },
  {
    q: "I'm at college — how do I move up from Alumni?",
    a: "Contributor and Counselor can be purchased directly, or unlocked through volunteer activity supporting Stellr. Contributor requires one qualifying activity; Counselor requires multiple. Upgrades are manually processed by Stellr admin — get in touch once you've completed qualifying activities.",
  },
  {
    q: 'Can an educator buy membership for their students?',
    a: 'When an educator purchases an Innovator or Trailblazer tier for a campaign, all associated student accounts in their cohort are automatically upgraded to Pathfinder for the duration. Contact us if you need help setting up a school cohort.',
  },
  {
    q: 'Is membership available outside the USA?',
    a: 'Yes — we are a global organisation. At present, the majority of our in-person events take place in the USA. Campaigns and Academy activities can be completed from anywhere.',
  },
]

export function MembershipFaq() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div>
      {faqs.map((faq, i) => (
        <div key={i} className="border-b border-line-light first:border-t first:border-line-light">
          <button
            className="flex w-full items-center justify-between gap-4 py-[18px] text-left text-[15px] font-semibold text-ink hover:text-primary transition-colors select-none"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            {faq.q}
            <span
              className="text-xl leading-none text-content-muted shrink-0 transition-transform duration-200"
              style={{ transform: open === i ? 'rotate(45deg)' : undefined }}
              aria-hidden="true"
            >
              +
            </span>
          </button>
          {open === i && (
            <p className="pb-[18px] text-[14.5px] leading-[1.7] text-content-secondary">
              {faq.a}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
