import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ProgressionGraphic } from './competition'

const meta: Meta = { title: 'Competition/ProgressionGraphic', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Progression: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content">
      <ProgressionGraphic
        heading="Where it leads"
        note="More info coming soon"
        nodes={[
          { label: 'Take part', labelClass: 'text-primary', title: 'Enter a Campaign or Event' },
          { label: 'Advance', labelClass: 'text-space-violet', title: 'Award Winners are invited to progress' },
          { label: 'Summer Camp', labelClass: 'text-brand-gold-ink', title: 'International Summer Camp (mid-July)', titleClass: 'text-brand-gold-ink', cardClass: 'bg-pathway-amber-bg border border-pathway-amber/30', star: true },
        ]}
      />
    </div>
  ),
}
