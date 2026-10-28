import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AudioTestimonial } from './AudioTestimonial'

// Audio-only testimonial with a transcript download beneath. Fixture is inline
// (lib/media-manifest is server-only); the clip and transcript URLs are
// placeholders, so the player shows but does not play.
const meta: Meta<typeof AudioTestimonial> = {
  title: 'Media/AudioTestimonial',
  component: AudioTestimonial,
  args: {
    audio: {
      id: 'sample-audio',
      src: '/audio/sample.m4a',
      title: 'Sample teacher — audio testimonial',
      transcriptHref: '/files/sample-transcript.pdf',
    },
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof AudioTestimonial>

export const Default: Story = {}
