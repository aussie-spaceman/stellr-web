import { describe, it, expect } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Toaster, toast } from './Toast'

describe('Toast (F-01 / F-04)', () => {
  it('stays backward compatible with the plain toast(message) call', () => {
    render(<Toaster />)
    act(() => {
      toast('Saved')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('renders an action link with the given label and href', () => {
    render(<Toaster />)
    act(() => {
      toast("You've joined Mission Control", {
        action: { label: 'Go to space →', href: '/community/mission-control' },
      })
    })
    const link = screen.getByRole('link', { name: 'Go to space →' })
    expect(link).toHaveAttribute('href', '/community/mission-control')
  })

  it('renders error-tone toasts', () => {
    render(<Toaster />)
    act(() => {
      toast("Couldn't join — please try again.", { tone: 'error' })
    })
    expect(screen.getByRole('status')).toHaveTextContent("Couldn't join — please try again.")
  })
})
