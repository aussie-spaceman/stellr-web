import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSearch } from './AppSearch'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

describe('AppSearch', () => {
  it('focuses the field inside the tap and gives it its own row on a phone', async () => {
    render(<AppSearch />)
    const user = userEvent.setup()
    const field = screen.getByRole('searchbox', { name: 'Search the community' })
    // Collapsed, it is out of the tab order.
    expect(field).toHaveAttribute('tabindex', '-1')

    await user.click(screen.getByRole('button', { name: 'Open search' }))
    expect(field).toHaveFocus()
    expect(field).toHaveAttribute('tabindex', '0')
    // Below sm: a full-width row under the bar; from sm: inline in the bar.
    expect(field.parentElement?.className).toContain('absolute inset-x-0 top-full')
    expect(field.parentElement?.className).toContain('sm:static')

    await user.type(field, 'rockets{Enter}')
    expect(push).toHaveBeenCalledWith('/community/search?q=rockets')
  })
})
