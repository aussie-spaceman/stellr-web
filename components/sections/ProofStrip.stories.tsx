import type { Meta, StoryObj } from '@storybook/nextjs'
import { ProofStrip } from './ProofStrip'
import { DEFAULT_PHOTO_CREDIT, PHOTO_WIDTHS, mediaUrl, type PhotoAsset } from '@/lib/media-helpers'

// T3 — captioned photo strip with a focus-trapped, keyboard-navigable lightbox.
// Fixtures are inline: lib/media-manifest is server-only.
const photo = (id: string, alt: string, caption?: string): PhotoAsset => ({
  id,
  src: mediaUrl(`/media/${id}`),
  alt,
  caption,
  credit: DEFAULT_PHOTO_CREDIT,
  widths: PHOTO_WIDTHS,
})
const events = [
  photo('events-1', 'Students working on laptops around a table at a competition', 'Future engineers learning the joys of early mornings'),
  photo('events-2', 'A participant with a laptop listening during a team discussion', 'Collaboration = listening'),
  photo('events-3', 'Three participants smiling together at an event', 'Teamwork makes the dream work'),
  photo('events-4', 'Working late into the night at one of our residential events'),
  photo('events-5', 'Students sitting on the floor working on a 3D design on a laptop', 'Designers hard at work'),
]

const meta: Meta<typeof ProofStrip> = {
  title: 'Media/ProofStrip',
  component: ProofStrip,
  args: { heading: 'On the competition floor', photos: events },
}
export default meta

type Story = StoryObj<typeof ProofStrip>

export const FiveUp: Story = {}
export const FourUp: Story = { args: { columns: 4, photos: events.slice(1, 5) } }
export const ThreeUp: Story = { args: { columns: 3, photos: events.slice(0, 3) } }
export const Single: Story = { args: { columns: 1, photos: events.slice(3, 4) } }
export const Mobile: Story = { parameters: { viewport: { value: 'mobile' } } }
