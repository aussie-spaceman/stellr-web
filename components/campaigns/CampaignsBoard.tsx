'use client'

import { useState } from 'react'
import { CampaignCard, type CampaignCardVM } from './CampaignCard'
import { CampaignRegistrationModal, type RegContext } from './CampaignRegistrationModal'

interface Props {
  campaigns: CampaignCardVM[]
  regContext: RegContext
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
}

// Client wrapper for a grid of Campaign cards that share one registration modal.
// Used on the public /events board and reusable anywhere campaigns are listed.
export function CampaignsBoard({ campaigns, regContext, membership }: Props) {
  const [active, setActive] = useState<CampaignCardVM | null>(null)
  const [registered, setRegistered] = useState<Set<string>>(
    () => new Set(campaigns.filter((c) => c.registered).map((c) => c.slug)),
  )

  return (
    <>
      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
        {campaigns.map((c) => (
          <CampaignCard
            key={c.slug}
            campaign={{ ...c, registered: registered.has(c.slug) }}
            onRegister={setActive}
          />
        ))}
      </div>

      <CampaignRegistrationModal
        open={active !== null}
        onClose={() => setActive(null)}
        regContext={regContext}
        membership={membership}
        campaign={
          active && {
            slug: active.slug,
            title: active.title,
            theme: active.theme,
            themeLabel: active.themeLabel,
            seasonLabel: active.seasonLabel,
            deadlineLabel: active.deadlineLabel,
          }
        }
        onRegistered={(slug) => setRegistered((cur) => new Set(cur).add(slug))}
      />
    </>
  )
}
