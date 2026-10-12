import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WhitePaperGate } from './WhitePaperGate'
import { __resetMemberPrefillCache } from '@/components/forms/useMemberPrefill'

// deep review PUB-10: the white-paper modal had no dialog semantics, no Esc and
// no focus management — a screen-reader user could tab into the page behind it.
// It should match the AssetGate dialog pattern (role=dialog, aria-modal, Esc,
// focus restore).
afterEach(() => __resetMemberPrefillCache())

describe('WhitePaperGate modal (PUB-10)', () => {
  it('exposes a labelled modal dialog when opened', async () => {
    const user = userEvent.setup()
    render(<WhitePaperGate />)

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: /get the white paper/i }))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName()
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup()
    render(<WhitePaperGate />)

    const trigger = screen.getByRole('button', { name: /get the white paper/i })
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })
})
