import type { Meta, StoryObj } from '@storybook/nextjs'
import { Button, Eyebrow, Badge, SectionHeading } from './primitives'

const meta: Meta = { title: 'Primitives' }
export default meta

export const Buttons: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-wrap gap-4 items-center">
      <Button href="/events" variant="primary">Primary</Button>
      <Button href="/events" variant="secondary">Secondary</Button>
      <Button href="/events" variant="energy">Energy</Button>
      <Button href="/events" variant="softBlue">Soft blue</Button>
      <Button href="/events" variant="softAmber">Soft amber</Button>
      <div className="bg-midnight p-4 rounded-panel">
        <Button href="/events" variant="outlineWhite">Outline white</Button>
      </div>
    </div>
  ),
}

export const Eyebrows: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-col gap-3">
      <Eyebrow>Start here</Eyebrow>
      <Eyebrow className="text-space-violet">Theme</Eyebrow>
      <Eyebrow className="text-enviro-green">Included</Eyebrow>
    </div>
  ),
}

export const Badges: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-wrap gap-4">
      <Badge>Best Value</Badge>
      <Badge className="bg-pathway-amber-bg text-brand-gold-ink">More info coming soon</Badge>
      <Badge className="bg-enviro-green-bg text-enviro-green-text">Free</Badge>
    </div>
  ),
}

export const Headings: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-col gap-8">
      <SectionHeading eyebrow="Start here" title="What's a Design Competition?" />
      <SectionHeading step="STEP 1" title="Choose how you take part" />
      <SectionHeading step="STEP 2" stepClassName="text-space-violet" title="Pick a theme" />
      <SectionHeading step="STEP 3" stepClassName="text-enviro-green" title="See what's included" />
    </div>
  ),
}
