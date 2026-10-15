import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, ConfirmDialog } from './Dialog'

function Harness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <main>
        <button type="button" onClick={() => setOpen(true)}>
          Open it
        </button>
      </main>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Download the guide"
        description="We'll email you a copy."
        dismissible={dismissible}
        footer={<button type="submit">Send</button>}
      >
        <label htmlFor="email">Email</label>
        <input id="email" />
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a named modal dialog that takes focus and makes the page inert', async () => {
    render(<Harness />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open it' }))

    const dialog = screen.getByRole('dialog', { name: 'Download the guide' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription("We'll email you a copy.")
    expect(screen.getByLabelText('Email')).toHaveFocus()
    // The page behind can't be reached by Tab or a screen reader's swipe.
    expect(screen.getByRole('button', { name: 'Open it', hidden: true }).closest('[inert]')).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('holds Tab inside, closes on Escape and returns focus to the trigger', async () => {
    render(<Harness />)
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', { name: 'Open it' })
    await user.click(trigger)

    // Field → Send → Close → back to the field (the close button sits in the
    // header, which comes first in the DOM, so Shift+Tab from the field lands on it).
    await user.tab()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(trigger.closest('[inert]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('ignores Escape and shows no close button when not dismissible', async () => {
    render(<Harness dismissible={false} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ConfirmDialog', () => {
  it('asks as an alertdialog with the confirm button focused', async () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        title="Delete this message?"
        description="It can't be recovered."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this message?' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()

    const user = userEvent.setup()
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cannot be dismissed while busy', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open busy title="Deleting" onConfirm={() => {}} onCancel={onCancel} />)
    await userEvent.setup().keyboard('{Escape}')
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
  })
})
