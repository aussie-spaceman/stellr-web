import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Badge } from './primitives'

const meta: Meta = { title: 'Primitives/Badge' }
export default meta

export const Badges: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-wrap gap-4">
      <Badge>Best Value</Badge>
      <Badge className="bg-pathway-amber-bg text-brand-gold-ink">More info coming soon</Badge>
      <Badge className="bg-enviro-green-bg text-enviro-green-text">Free</Badge>
    </div>
  ),
}
