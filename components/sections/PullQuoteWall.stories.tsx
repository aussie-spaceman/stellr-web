import type { Meta, StoryObj } from '@storybook/nextjs'
import { PullQuoteWall } from './PullQuoteWall'
import type { QuoteAsset } from '@/lib/media-helpers'

// T6 — attributed pull-quote wall, colour-coded by voice (student/educator/
// mentor/parent). Zero media weight. Fixtures are inline: lib/media-manifest is
// server-only.
const quotes: QuoteAsset[] = [
  { id: 'student', audience: 'student', name: 'Competition Participant', meta: '2023 Student Participant', text: "I do this competition just because it's like a great way to experience other schools and other people's intelligence and hear ideas from other people." },
  { id: 'parent', audience: 'parent', name: 'Competition Parent', meta: '2021 Parent', text: "He's gotten the opportunity to have leadership roles and he's interacted with people from all over the world." },
  { id: 'educator', audience: 'educator', name: 'Sample educator', meta: 'Storybook fixture', text: 'Sample quote text for the educator voice.' },
  { id: 'mentor', audience: 'mentor', name: 'Sample mentor', meta: 'Storybook fixture', text: 'Sample quote text for the mentor voice.' },
]

const meta: Meta<typeof PullQuoteWall> = {
  title: 'Media/PullQuoteWall',
  component: PullQuoteWall,
  args: { quotes, columns: 3 },
}
export default meta

type Story = StoryObj<typeof PullQuoteWall>

export const AllVoices: Story = {}
export const TwoColumns: Story = { args: { columns: 2 } }
export const SingleQuote: Story = { args: { quotes: quotes.slice(0, 1), columns: 1 } }
export const Mobile: Story = { parameters: { viewport: { value: 'mobile' } } }
