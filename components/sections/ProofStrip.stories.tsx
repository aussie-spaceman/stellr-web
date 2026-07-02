import type { Meta, StoryObj } from '@storybook/nextjs'
import { ProofStrip } from './ProofStrip'
import { PHOTOS } from '@/lib/media-manifest'

// T3 — captioned photo strip with a focus-trapped, keyboard-navigable lightbox.
// (Assets resolve from /public via Storybook staticDirs.)
const meta: Meta<typeof ProofStrip> = {
  title: 'Media/ProofStrip',
  component: ProofStrip,
  args: {
    heading: 'On the competition floor',
    photos: [PHOTOS['events-1'], PHOTOS['events-2'], PHOTOS['events-3'], PHOTOS['events-4'], PHOTOS['events-5']],
  },
}
export default meta

type Story = StoryObj<typeof ProofStrip>

export const FiveUp: Story = {}
export const ThreeUp: Story = {
  args: {
    columns: 3,
    photos: [PHOTOS['students-hero'], PHOTOS['students-strip-1'], PHOTOS['students-strip-2']],
  },
}
export const Mobile: Story = { parameters: { viewport: { value: 'mobile' } } }
