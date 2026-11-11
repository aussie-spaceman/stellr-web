import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { PathwayCard } from './competition'

const meta: Meta = { title: 'Competition/PathwayCard', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Pathways: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-content">
      <PathwayCard
        eyebrow="Pathway 1"
        name="Live Event"
        tagline="A competition run by Stellr"
        headerClass="bg-gradient-to-br from-primary to-primary-deep"
        rows={[['Who runs it', 'Stellr staff'], ['Where', 'In-person or virtual'], ['How long', 'Fixed dates']]}
        cta={{ label: 'Browse upcoming events', href: '/events', className: 'bg-primary-soft text-primary hover:bg-primary/15' }}
      />
      <PathwayCard
        eyebrow="Pathway 2"
        name="Curriculum Campaign"
        tagline="You run it in class, from our curriculum"
        headerClass="bg-gradient-to-br from-pathway-amber to-[#C2722A]"
        rows={[['Who runs it', 'You, the educator'], ['Where', 'Your school or classroom'], ['How long', 'Flexible — you set the pace']]}
        cta={{ label: 'Download curriculum', href: '/activities', className: 'bg-pathway-amber-bg text-brand-gold-ink hover:bg-pathway-amber/15' }}
      />
    </div>
  ),
}
