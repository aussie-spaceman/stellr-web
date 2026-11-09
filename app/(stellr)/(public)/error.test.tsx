import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PublicError from './error'

// deep review PUB-9: the public error boundary must give a visitor a way out —
// a working retry — rather than a dead "Application error" screen.
describe('public error boundary', () => {
  it('renders a retry control that calls reset()', async () => {
    const reset = vi.fn()
    render(<PublicError error={new Error('boom')} reset={reset} />)

    const retry = screen.getByRole('button', { name: /try again/i })
    await userEvent.click(retry)
    expect(reset).toHaveBeenCalledOnce()
  })

  it('offers a route home', () => {
    render(<PublicError error={new Error('boom')} reset={() => {}} />)
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/')
  })
})
