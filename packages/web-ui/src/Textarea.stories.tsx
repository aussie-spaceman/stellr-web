import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Field, Textarea } from './forms'

const meta: Meta = { title: 'Forms/Textarea' }
export default meta

/** A multi-line field inside a Field. */
export const Default: StoryObj = {
  render: () => (
    <div className="max-w-md space-y-5 bg-white p-6">
      <Field label="Anything we should know?" hint="Dietary needs, access needs, or anything else.">
        <Textarea rows={3} />
      </Field>
    </div>
  ),
}
