import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { SectionHeading } from './primitives'

const meta: Meta = { title: 'Primitives/SectionHeading' }
export default meta

export const Headings: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-col gap-8">
      <SectionHeading eyebrow="Start here" title="What's a Design Competition?" />
      <SectionHeading step="STEP 1" title="Choose how you take part" />
      <SectionHeading step="STEP 2" stepClassName="text-space-violet" title="Pick a theme" />
      <SectionHeading step="STEP 3" stepClassName="text-enviro-green-text" title="See what's included" />
    </div>
  ),
}
