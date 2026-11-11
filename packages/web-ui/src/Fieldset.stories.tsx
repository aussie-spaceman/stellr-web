import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Choice, Fieldset } from './forms'

const meta: Meta = { title: 'Forms/Fieldset' }
export default meta

/** A group of choices under one legend, with hint or error text for the group. */
export const WithHint: StoryObj = {
  render: () => (
    <div className="max-w-md bg-white p-6">
      <Fieldset legend="Which theme will your class enter?" hint="You can change this until the brief is released.">
        <div className="flex flex-wrap gap-x-6">
          <Choice type="radio" name="theme" label="Space" defaultChecked />
          <Choice type="radio" name="theme" label="Environmental" />
        </div>
      </Fieldset>
    </div>
  ),
}

export const WithError: StoryObj = {
  render: () => (
    <div className="max-w-md bg-white p-6">
      <Fieldset legend="T-shirt size" error="Choose a size">
        <div className="flex flex-wrap gap-x-6">
          <Choice type="radio" name="shirt" label="Small" />
          <Choice type="radio" name="shirt" label="Medium" />
          <Choice type="radio" name="shirt" label="Large" />
        </div>
      </Fieldset>
    </div>
  ),
}
