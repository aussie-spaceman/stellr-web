import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Field, Select } from './forms'

const meta: Meta = { title: 'Forms/Select' }
export default meta

/** A native select inside a Field. Start with a disabled prompt option. */
export const Default: StoryObj = {
  render: () => (
    <div className="max-w-md space-y-5 bg-white p-6">
      <Field label="Grade">
        <Select defaultValue="">
          <option value="" disabled>
            Choose a grade
          </option>
          <option>Grade 9</option>
          <option>Grade 10</option>
          <option>Grade 11</option>
          <option>Grade 12</option>
        </Select>
      </Field>
      <Field label="T-shirt size" error="Choose a size">
        <Select defaultValue="">
          <option value="" disabled>
            Choose a size
          </option>
          <option>Small</option>
          <option>Medium</option>
          <option>Large</option>
        </Select>
      </Field>
    </div>
  ),
}
