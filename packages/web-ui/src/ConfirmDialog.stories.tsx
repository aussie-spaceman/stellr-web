import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { ConfirmDialog } from './Dialog'

const meta: Meta = { title: 'Overlays/ConfirmDialog' }
export default meta

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
