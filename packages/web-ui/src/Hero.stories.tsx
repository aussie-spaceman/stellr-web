import type { Meta, StoryObj } from '@storybook/nextjs'
import { Hero } from './Hero'

const meta: Meta<typeof Hero> = {
  title: 'Sections/Hero',
  component: Hero,
  args: {
    breadcrumb: 'Educate → Competitions',
    pill: { accent: 'Themed Competitions', rest: 'In class, or join an event' },
    title: 'Design Competitions',
    lead: 'Real professional STEM skills for high school students — delivered through competitive, industry-simulation activities.',
    pills: ['High school students', 'State & national', 'Free for students to enter'],
  },
}
export default meta

type Story = StoryObj<typeof Hero>

export const Desktop: Story = { parameters: { viewport: { value: 'desktop' } } }
export const Tablet: Story = { parameters: { viewport: { value: 'tablet' } } }
export const Mobile: Story = { parameters: { viewport: { value: 'mobile' } } }
export const NoGlow: Story = { args: { glow: false } }
