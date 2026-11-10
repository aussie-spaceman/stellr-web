import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { InfoPill } from './primitives'

const meta: Meta = { title: 'Primitives/InfoPill', parameters: { backgrounds: { value: 'midnight' } } }
export default meta

/** The translucent pills on the dark hero: short facts, never actions. */
export const OnHero: StoryObj = {
  render: () => (
    <div className="bg-midnight p-8 flex flex-wrap gap-3">
      <InfoPill>High school students</InfoPill>
      <InfoPill>State & national</InfoPill>
      <InfoPill>Free for students to enter</InfoPill>
    </div>
  ),
}
