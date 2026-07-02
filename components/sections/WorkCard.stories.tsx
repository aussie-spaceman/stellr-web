import type { Meta, StoryObj } from '@storybook/nextjs'
import { WorkCard } from './WorkCard'
import { COMPETITION } from '@/lib/media-manifest'

// T4 — work card: preview always open; full PDF gated (email-only modal) for
// subscriber content, direct download for free content.
const meta: Meta<typeof WorkCard> = {
  title: 'Media/WorkCard',
  component: WorkCard,
  decorators: [(Story) => <div style={{ maxWidth: 560 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof WorkCard>

export const FreeDownload: Story = { args: { asset: COMPETITION['previous-participant-work'] } }
export const GatedDownload: Story = { args: { asset: COMPETITION['jsc-2025-program-book'] } }
