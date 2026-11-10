import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from './primitives'

const meta: Meta = { title: 'Primitives/Button' }
export default meta

export const Buttons: StoryObj = {
  render: () => (
    <div className="p-8 flex flex-wrap gap-4 items-center">
      <Button href="/events" variant="primary">Primary</Button>
      <Button href="/events" variant="secondary">Secondary</Button>
      <Button href="/events" variant="energy">Energy</Button>
      <Button href="/events" variant="softBlue">Soft blue</Button>
      <Button href="/events" variant="softAmber">Soft amber</Button>
      <Button href="/events" variant="primaryStrong">Primary (AA)</Button>
      <Button href="/events" variant="secondaryStrong">Secondary (AA)</Button>
      <div className="bg-midnight p-4 rounded-panel">
        <Button href="/events" variant="outlineWhite">Outline white</Button>
      </div>
    </div>
  ),
}
