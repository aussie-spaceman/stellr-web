import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Field, Input } from './forms'

const meta: Meta = { title: 'Forms/Input' }
export default meta

/** A text input inside a Field, which supplies its label, hint and error wiring. */
export const States: StoryObj = {
  render: () => (
    <div className="max-w-md space-y-5 bg-white p-6">
      <Field label="School name">
        <Input placeholder="e.g. Lincoln High School" />
      </Field>
      <Field label="Email" error="Enter an email address like name@school.org">
        <Input type="email" defaultValue="not-an-email" />
      </Field>
      <Field label="Event code" hint="Set by Stellr — you can't change it.">
        <Input defaultValue="SDC-2027" disabled />
      </Field>
    </div>
  ),
}
