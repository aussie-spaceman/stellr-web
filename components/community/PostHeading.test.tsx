import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PostHeading } from './PostHeading'

describe('PostHeading (F-03)', () => {
  it('renders the title as an h1', () => {
    render(<PostHeading title="Launch day questions" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Launch day questions')
  })

  it('renders no heading element for a null title', () => {
    const { container } = render(<PostHeading title={null} />)
    expect(container.querySelector('h1')).toBeNull()
  })

  it('renders no heading element for an empty or whitespace title', () => {
    const { container } = render(
      <>
        <PostHeading title="" />
        <PostHeading title="   " />
      </>
    )
    expect(container.querySelector('h1')).toBeNull()
  })
})
