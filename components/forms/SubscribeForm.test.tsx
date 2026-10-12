import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SubscribeForm } from './SubscribeForm'
import { __resetMemberPrefillCache } from './useMemberPrefill'

// deep review PUB-10: the site-wide footer subscribe field was placeholder-only,
// so it had no programmatic label for assistive tech (WCAG 1.3.1 / 4.1.2 / 3.3.2).
afterEach(() => __resetMemberPrefillCache())

describe('SubscribeForm', () => {
  it('gives the email field an accessible name', () => {
    render(<SubscribeForm />)
    expect(screen.getByRole('textbox', { name: /email address/i })).toBeInTheDocument()
  })
})
