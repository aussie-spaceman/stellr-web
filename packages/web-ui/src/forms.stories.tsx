import type { Meta, StoryObj } from '@storybook/nextjs'
import { Choice, Field, Fieldset, Input, Select, Textarea } from './forms'

const meta: Meta = { title: 'Forms/Primitives' }
export default meta

/** Labels tied to their fields, 16px text on touch, 44px tall, ≥3:1 borders. */
export const Fields: StoryObj = {
  render: () => (
    <form className="max-w-md space-y-5 bg-white p-6" onSubmit={(e) => e.preventDefault()}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First name" required>
          <Input autoComplete="given-name" />
        </Field>
        <Field label="Last name" required>
          <Input autoComplete="family-name" />
        </Field>
      </div>
      <Field label="Email" hint="Confirmations go here.">
        <Input type="email" autoComplete="email" />
      </Field>
      <Field label="Grade">
        <Select defaultValue="">
          <option value="" disabled>
            Choose a grade
          </option>
          <option>Grade 9</option>
          <option>Grade 10</option>
        </Select>
      </Field>
      <Field label="Anything we should know?">
        <Textarea rows={3} />
      </Field>
    </form>
  ),
}

export const WithErrors: StoryObj = {
  render: () => (
    <form className="max-w-md space-y-5 bg-white p-6" onSubmit={(e) => e.preventDefault()}>
      <Field label="Email" error="Enter an email address like name@school.org">
        <Input type="email" defaultValue="not-an-email" />
      </Field>
      <Fieldset legend="T-shirt size" error="Choose a size">
        <div className="flex flex-wrap gap-x-6">
          <Choice type="radio" name="shirt" label="Small" />
          <Choice type="radio" name="shirt" label="Medium" />
          <Choice type="radio" name="shirt" label="Large" />
        </div>
      </Fieldset>
      <Choice type="checkbox" label="I agree to the event terms" />
    </form>
  ),
}
