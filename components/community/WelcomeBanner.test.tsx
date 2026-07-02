import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WelcomeBanner } from './WelcomeBanner'

describe('WelcomeBanner (F-07)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('welcomes without emoji, using the sanctioned star flourish', () => {
    const { container } = render(<WelcomeBanner firstName="Ada" />)
    expect(screen.getByText(/Welcome to Stellr, Ada/)).toBeInTheDocument()
    expect(container.textContent).not.toContain('🎉')
    expect(container.textContent).toContain('✦')
  })
})
