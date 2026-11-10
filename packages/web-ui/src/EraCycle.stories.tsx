import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { EraCycle } from './competition'

const meta: Meta = { title: 'Competition/EraCycle', parameters: { backgrounds: { value: 'surface' } } }
export default meta

export const FutureHistoryCycle: StoryObj = {
  render: () => (
    <div className="p-8 max-w-content">
      <EraCycle
        items={[
          { name: 'Cislunar space', scope: 'Earth orbit and the Moon', ahead: '+20 years', when: '2030 school year · set in 2050' },
          { name: 'Mars', scope: 'Mars and its moons, Phobos and Deimos', ahead: '+25 years', when: '2027 school year · set in 2052', current: true },
          { name: 'The inner solar system', scope: 'Mercury and Venus', ahead: '+30 years', when: '2028 school year · set in 2058' },
          { name: 'The outer solar system', scope: 'The asteroid belt and the gas giants', ahead: '+35 years', when: '2029 school year · set in 2064' },
        ]}
      />
    </div>
  ),
}
