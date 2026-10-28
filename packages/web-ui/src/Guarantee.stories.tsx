import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { GuaranteeBadge } from './Guarantee'

const meta: Meta<typeof GuaranteeBadge> = {
  title: 'Guarantee',
  component: GuaranteeBadge,
  args: { days: 45, href: '/terms#guarantee' },
}
export default meta

type Story = StoryObj<typeof GuaranteeBadge>

/** Beside a section of prices or tier cards. */
export const Full: Story = {
  render: (args) => (
    <div className="p-8 max-w-xl">
      <GuaranteeBadge {...args} />
    </div>
  ),
}

/** Beside a price or a pay button. */
export const Compact: Story = {
  render: (args) => (
    <div className="p-8 max-w-md">
      <GuaranteeBadge {...args} variant="compact" />
    </div>
  ),
}

/** On midnight — the event page's side panel, the CTA band. */
export const OnDark: Story = {
  render: (args) => (
    <div className="bg-midnight p-8 max-w-xl space-y-4">
      <GuaranteeBadge {...args} onDark />
      <GuaranteeBadge {...args} variant="compact" onDark />
    </div>
  ),
}
