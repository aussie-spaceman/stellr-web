import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Dialog, ConfirmDialog } from './Dialog'
import { Field, Input } from './forms'

const meta: Meta = { title: 'Overlays/Dialog' }
export default meta

/** A form in a dialog: a sheet on phones, the actions pinned under the body. */
export const WithForm: StoryObj = {
  render: function Render() {
    const [open, setOpen] = useState(true)
    return (
      <div className="p-8">
        <button type="button" className="min-h-11 rounded-control bg-primary-deep px-4 text-white" onClick={() => setOpen(true)}>
          Open the dialog
        </button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Get the competition guide"
          description="We'll email you a copy."
          footer={
            <button type="submit" form="guide-form" className="min-h-11 rounded-control bg-primary-deep px-4 text-sm font-semibold text-white">
              Send it
            </button>
          }
        >
          <form id="guide-form" className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <Field label="First name">
              <Input autoComplete="given-name" />
            </Field>
            <Field label="Email" hint="We only use it to send the guide.">
              <Input type="email" autoComplete="email" />
            </Field>
          </form>
        </Dialog>
      </div>
    )
  },
}

export const Confirm: StoryObj = {
  render: function Render() {
    const [open, setOpen] = useState(true)
    return (
      <div className="p-8">
        <button type="button" className="min-h-11 rounded-control border border-line-strong px-4" onClick={() => setOpen(true)}>
          Delete message
        </button>
        <ConfirmDialog
          open={open}
          title="Delete this message?"
          description="It can't be recovered."
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </div>
    )
  },
}
