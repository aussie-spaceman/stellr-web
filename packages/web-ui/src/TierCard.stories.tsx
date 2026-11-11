import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TierCard } from './competition'
import { BracketShadeKey } from './tier-shades'

const meta: Meta = { title: 'Competition/TierCard', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Tiers: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start max-w-content">
      <TierCard name="Subscriber" price="Free" accessNote="Publicly available" items={['RFP', 'Mission Handbook', 'Past work']} />
      <TierCard name="Educator" price="Free" accessNote="Free with a member account" inheritsFrom="Subscriber" items={['NSES map', 'Worksheets', 'Community Spaces']} />
      <TierCard name="Innovator" price="$500" accessNote="Free 1st year for participants" inheritsFrom="Educator" badge="Best Value" featured items={['Marking rubric', 'Lesson plans', 'AI sub-contractors', 'Certificates']} />
      <TierCard name="Trailblazer" price="$1,000" accessNote="Comprehensive support" inheritsFrom="Innovator" items={['Mentoring calls', 'CTE credits', 'Student awards']} />
    </div>
  ),
}

/* TierCard in select mode, rendering the shade strip, shade price and selected glow. */
export const TierCards: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content flex flex-col gap-3">
      <BracketShadeKey />
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[200px]"><TierCard tier="educator" role="Everyone starts here" name="Educator" price="Free" priceNote="always" cta={{ label: 'Join Free', href: '#' }} /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="catalyst" role="Competition toolkit" name="Catalyst" price="$149" priceNote="per year" selected cta={{ label: 'Sign up now', href: '#' }} /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="innovator" role="Mentoring & AI tools" name="Innovator" price="$499" priceNote="per year" cta={{ label: 'Sign up now', href: '#' }} /></div>
        <div className="flex-1 min-w-[200px]"><TierCard tier="trailblazer" role="For teachers who excel" name="Trailblazer" price="$999" priceNote="per year" cta={{ label: 'Sign up now', href: '#' }} /></div>
      </div>
    </div>
  ),
}
