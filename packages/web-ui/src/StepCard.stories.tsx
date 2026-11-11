import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { StepCard } from './competition'

const meta: Meta = { title: 'Competition/StepCard', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Steps: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 max-w-content">
      <StepCard n={1} title="Get the brief" body="A themed RFP sets a real engineering challenge." />
      <StepCard n={2} title="Form a team" body="Students work together like a professional firm." />
      <StepCard n={3} title="Design & decide" body="Research, prototype, weigh trade-offs, run the numbers." />
      <StepCard n={4} title="Build the deliverable" body="A written proposal or a presentation of the solution." />
      <StepCard n={5} title="Pitch & be judged" body="Present to judges; award winners are invited to our International Summer Camp." />
    </div>
  ),
}
