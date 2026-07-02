'use client'

import { useState } from 'react'
import { Button } from '@stellr/web-ui'
import {
  CampaignRegistrationModal,
  type CampaignOption,
  type RegContext,
} from './CampaignRegistrationModal'

interface Props {
  campaign: CampaignOption
  regContext: RegContext
  membership?: { schoolName?: string | null; roleLabel?: string | null } | null
  registered?: boolean
  defaultGroupName?: string
  label?: string
  fullWidth?: boolean
}

// A single primary button that opens the shared registration modal for one
// campaign. Used on the campaign detail page and the member dashboard prompt.
export function CampaignRegisterButton({
  campaign,
  regContext,
  membership,
  registered = false,
  defaultGroupName,
  label = 'Register group for this Campaign',
  fullWidth = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState(registered)

  if (done) {
    return (
      <Button href={`/campaigns/${campaign.slug}`} variant="primary" className={fullWidth ? 'w-full justify-center' : ''}>
        Go to your campaign →
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="primary"
        onClick={() => setOpen(true)}
        className={fullWidth ? 'w-full justify-center' : ''}
      >
        {label}
      </Button>
      <CampaignRegistrationModal
        open={open}
        onClose={() => setOpen(false)}
        campaign={campaign}
        regContext={regContext}
        membership={membership}
        defaultGroupName={defaultGroupName}
        onRegistered={() => setDone(true)}
      />
    </>
  )
}
