import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Launch, Environment } from '@stellr/icons'
import { ThemeCard } from './competition'

const meta: Meta = { title: 'Competition/ThemeCard', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const Themes: StoryObj = {
  render: () => (
    <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-content">
      <ThemeCard
        name="Space"
        Icon={Launch}
        iconBg="bg-space-violet"
        accent="text-space-violet-text"
        border="border-space-violet-chip"
        headerBg="bg-gradient-to-b from-space-violet-bg to-white"
        briefBg="bg-space-violet-bg"
        blurb="Engineering inspired by space exploration — the systems that keep a mission alive and on course."
        explore={['Propulsion & trajectory', 'Life support', 'Radiation shielding', 'Power & storage', 'Comms', 'Mass & cost budgets']}
        brief="Design a lunar-surface habitat that keeps a four-person crew alive for 90 days."
      />
      <ThemeCard
        name="Environmental"
        Icon={Environment}
        iconBg="bg-enviro-green"
        accent="text-enviro-green-text"
        border="border-enviro-green-chip"
        headerBg="bg-gradient-to-b from-enviro-green-bg to-white"
        briefBg="bg-enviro-green-bg"
        blurb="Real-world environmental problems solved through systems thinking and honest trade-offs."
        explore={['Renewable energy', 'Water & waste', 'Emissions modelling', 'Cost vs impact', 'Climate constraints', 'Payback']}
        brief="Design a net-zero energy system for a town of 5,000 with a 10-year payback target."
      />
    </div>
  ),
}
