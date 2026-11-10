import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Choice } from './forms'

const meta: Meta = { title: 'Forms/Choice' }
export default meta

/** A checkbox or radio with its label, sized for a fingertip. */
export const Checkbox: StoryObj = {
  render: () => (
    <div className="max-w-md bg-white p-6">
      <Choice type="checkbox" label="I agree to the event terms" />
      <Choice type="checkbox" label="Email me about future competitions" defaultChecked />
    </div>
  ),
}

export const Radio: StoryObj = {
  render: () => (
    <div className="max-w-md bg-white p-6 flex flex-wrap gap-x-6">
      <Choice type="radio" name="format" label="In person" defaultChecked />
      <Choice type="radio" name="format" label="Virtual" />
    </div>
  ),
}
