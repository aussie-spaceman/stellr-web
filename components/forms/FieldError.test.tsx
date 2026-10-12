import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FieldError from './FieldError'

// deep review PUB-10 (WCAG 3.3.1 / 4.1.3): a validation message that appears
// after a failed submit must be announced to assistive tech. role="alert" makes
// the message a live region, so every public form that renders FieldError
// (Contact/Host/Network/Scholarship, LeadForm) announces its errors.
describe('FieldError', () => {
  it('exposes the message as an alert so screen readers announce it', () => {
    render(<FieldError message="Please enter a valid email address" id="e1" />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Please enter a valid email address')
    expect(alert).toHaveAttribute('id', 'e1')
  })

  it('renders nothing when there is no message', () => {
    const { container } = render(<FieldError />)
    expect(container).toBeEmptyDOMElement()
  })
})
