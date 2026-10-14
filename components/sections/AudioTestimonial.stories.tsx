import type { Meta, StoryObj } from '@storybook/nextjs'
import { AudioTestimonial } from './AudioTestimonial'

// Audio-only testimonial with its transcript printed beneath. Fixture is
// inline sample text (lib/media-manifest is server-only); the clip URL is a
// placeholder, so the player shows but does not play.
const meta: Meta<typeof AudioTestimonial> = {
  title: 'Media/AudioTestimonial',
  component: AudioTestimonial,
  args: {
    audio: {
      id: 'sample-audio',
      src: '/audio/sample.m4a',
      title: 'Sample teacher — audio testimonial',
      transcript: [
        'Interviewer: Sample question about running the program in a classroom.',
        'Teacher: Sample answer, one line per turn, shown as "Speaker: words".',
        'A line without a speaker renders as plain text.',
      ].join('\n'),
    },
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof AudioTestimonial>

export const Default: Story = {}
