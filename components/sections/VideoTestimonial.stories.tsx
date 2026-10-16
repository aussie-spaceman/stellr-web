import type { Meta, StoryObj } from '@storybook/nextjs'
import { VideoTestimonial } from './VideoTestimonial'
import { mediaUrl, sizedSrcSet } from '@/lib/media-helpers'

// T2/T5 — poster-first, click-to-play video (preload="none" + WebVTT captions).
// Fixture is inline: lib/media-manifest is server-only.
const base = '/videos/2026-10/testimonial-allyson-rose'
const meta: Meta<typeof VideoTestimonial> = {
  title: 'Media/VideoTestimonial',
  component: VideoTestimonial,
  args: {
    src: mediaUrl(`${base}.mp4`),
    poster: mediaUrl(`${base}.poster.jpg`),
    posterSrcSet: sizedSrcSet(`${base}.poster.jpg`, 1280),
    captionsSrc: mediaUrl(`${base}.en.vtt`),
    title: 'Allyson Rose — participant testimonial',
  },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof VideoTestimonial>

export const Default: Story = {}
export const NoPoster: Story = { args: { poster: undefined } }
