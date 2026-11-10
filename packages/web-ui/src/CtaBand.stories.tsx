import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { CtaBand } from './CtaBand'
import { Button } from './primitives'

const meta: Meta<typeof CtaBand> = {
  title: 'Sections/CtaBand',
  component: CtaBand,
  parameters: { backgrounds: { value: 'white' } },
}
export default meta

type Story = StoryObj<typeof CtaBand>

/** The navy card that closes a page: a title, a line of body, one or two actions. */
export const TwoActions: Story = {
  args: {
    title: 'Ready to start?',
    body: 'Register for an upcoming live event, or download curriculum to run a campaign in your classroom.',
    actions: (
      <>
        <Button href="/events" variant="primary">View Events</Button>
        <Button href="/curriculum" variant="outlineWhite">Browse Curriculum</Button>
      </>
    ),
  },
}

export const OneAction: Story = {
  args: {
    title: 'Download the lesson pack',
    body: 'A ready-to-run lesson plan and slide deck accompany this tutorial.',
    actions: <Button href="/curriculum" variant="primary">Browse the curriculum</Button>,
  },
}
