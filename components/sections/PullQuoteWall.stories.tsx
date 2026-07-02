import type { Meta, StoryObj } from '@storybook/nextjs'
import { PullQuoteWall } from './PullQuoteWall'
import { QUOTES } from '@/lib/media-manifest'

// T6 — attributed pull-quote wall, colour-coded by voice (student/educator/
// mentor/parent). Zero media weight.
const meta: Meta<typeof PullQuoteWall> = {
  title: 'Media/PullQuoteWall',
  component: PullQuoteWall,
  args: { quotes: Object.values(QUOTES), columns: 3 },
}
export default meta

type Story = StoryObj<typeof PullQuoteWall>

export const AllVoices: Story = {}
export const TwoColumns: Story = { args: { columns: 2 } }
export const SingleQuote: Story = { args: { quotes: [QUOTES['mitra-sainsbury']], columns: 1 } }
export const Mobile: Story = { parameters: { viewport: { value: 'mobile' } } }
