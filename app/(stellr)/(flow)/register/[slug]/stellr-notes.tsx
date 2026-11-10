import type { ReactNode } from 'react'
import { MissionFundingNote } from '@/components/ui/MissionFundingNote'
import { MoneyBackGuarantee } from '@/components/ui/MoneyBackGuarantee'

// Stellr's own notes on its registration forms (S5 A7): the money-back guarantee and
// the note on how Stellr's mission is funded. They are Stellr's promises, so the shared
// bodies render them only through this slot, which only Stellr's pages supply. A
// tenant's form gets neither.

export interface StellrRegistrationNotes {
  /** Shown where the form takes a fee. */
  guarantee: ReactNode
  missionFunding: ReactNode
}

export const stellrRegistrationNotes = (): StellrRegistrationNotes => ({
  guarantee: <MoneyBackGuarantee className="mt-8" />,
  missionFunding: <MissionFundingNote className="mt-10" />,
})
