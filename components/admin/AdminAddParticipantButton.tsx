'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ParticipantForm } from '@/components/member/ParticipantForm'

// "Add participant" on a group in the admin event roster (4 Nov 2026). Opens the
// organiser's own participant form, posting to the staff route, which runs the
// same shared add (lib/group-participant-add.ts): Member ID link, consent form,
// school link, payment link and the group-billing step. What the add did to the
// group's billing, if anything, is shown afterwards.
export function AdminAddParticipantButton({
  registrationId,
  className,
}: {
  registrationId: string
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <button
        type="button"
        onClick={() => { setNotice(null); setOpen(true) }}
        className={className ?? 'text-xs font-semibold text-brand-blue hover:underline'}
      >
        Add participant
      </button>
      {notice && <span role="status" className="text-xs font-normal normal-case text-content-secondary">{notice}</span>}
      {open && (
        <ParticipantForm
          registrationId={registrationId}
          createUrl={`/api/admin/registrations/${registrationId}/participants`}
          onCancel={() => setOpen(false)}
          onSaved={(billingMessage) => {
            setOpen(false)
            setNotice(billingMessage ? `Added. ${billingMessage}` : 'Added.')
            router.refresh()
          }}
        />
      )}
    </>
  )
}
