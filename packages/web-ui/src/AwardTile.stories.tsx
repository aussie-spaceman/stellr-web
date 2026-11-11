import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Idea, Award } from '@stellr/icons'
import { AwardTile } from './competition'

const meta: Meta = { title: 'Competition/AwardTile', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const AwardTiles: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
      <AwardTile
        name="Creative Vision Award"
        count="One per company"
        decidedBy="Chosen by mentors"
        summary="For the student whose vision shaped their company’s design."
        Icon={Idea}
        campInvite
        onOpen={() => {}}
      />
      <AwardTile
        name="Champions Award"
        count="One company"
        decidedBy="Chosen by judges"
        summary="Every member of the company with the winning design."
        Icon={Award}
        onOpen={() => {}}
      />
    </div>
  ),
}
