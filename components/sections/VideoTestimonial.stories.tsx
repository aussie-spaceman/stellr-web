import type { Meta, StoryObj } from '@storybook/nextjs'
import { VideoTestimonial } from './VideoTestimonial'
import { VIDEOS } from '@/lib/media-manifest'

// T2/T5 — poster-first, click-to-play video (preload="none" + WebVTT captions).
const v = VIDEOS['testimonial-allyson-rose']
const meta: Meta<typeof VideoTestimonial> = {
  title: 'Media/VideoTestimonial',
  component: VideoTestimonial,
  args: { src: v.src, poster: v.poster, captionsSrc: v.captions, title: v.title },
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof VideoTestimonial>

export const Default: Story = {}
export const NoPoster: Story = { args: { poster: undefined } }
