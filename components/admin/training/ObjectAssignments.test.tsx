import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ObjectAssignments } from './ObjectAssignments'
import type { TrainableObject } from '@/lib/training-admin'

// training-audience.6: picking an Object whose attach the API refuses used to
// close nothing and say nothing. The builder now shows the API's reason.

const objects: TrainableObject[] = [
  { type: 'cohort', ref: 'cohort-1', label: 'Spring Mentoring' },
  { type: 'competition', ref: 'evt', label: 'The Event' },
]

let respond: () => Promise<Response>

function pick(label: string) {
  return async () => {
    await userEvent.click(screen.getByRole('button', { name: /Assign to Object/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Select an Object' }))
    await userEvent.click(screen.getByRole('option', { name: label }))
  }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => respond()))
})

describe('ObjectAssignments — attaching a course', () => {
  const renderIt = () => render(<ObjectAssignments moduleId="mod-1" assignments={[]} objects={objects} tiers={[]} />)

  it('shows the API’s reason when the attach is refused', async () => {
    respond = async () =>
      new Response(JSON.stringify({ error: 'A course cannot be attached to a cohort (relationship matrix).' }), { status: 403 })
    renderIt()
    await pick('Spring Mentoring')()
    expect(await screen.findByRole('alert')).toHaveTextContent('A course cannot be attached to a cohort (relationship matrix).')
    // Nothing was added, and the picker stays open to choose another Object.
    expect(screen.queryByText('Cohort', { selector: 'span' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('falls back to a plain message when the refusal has no reason', async () => {
    respond = async () => new Response('Internal error', { status: 500 })
    renderIt()
    await pick('Spring Mentoring')()
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t assign this course to Spring Mentoring. Try again.')
  })

  it('says so when the request does not reach the server', async () => {
    respond = async () => {
      throw new TypeError('Failed to fetch')
    }
    renderIt()
    await pick('Spring Mentoring')()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Couldn’t assign this course to Spring Mentoring. Check your connection and try again.',
    )
  })

  it('clears the error once a later attach succeeds', async () => {
    respond = async () => new Response(JSON.stringify({ error: 'Refused.' }), { status: 403 })
    renderIt()
    await pick('Spring Mentoring')()
    expect(await screen.findByRole('alert')).toHaveTextContent('Refused.')

    respond = async () => new Response(JSON.stringify({ id: 'asg-1' }), { status: 200 })
    await userEvent.click(screen.getByRole('button', { name: 'Select an Object' }))
    await userEvent.click(screen.getByRole('option', { name: 'The Event' }))
    expect(await screen.findByText('Competition')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('clears the error on Cancel', async () => {
    respond = async () => new Response(JSON.stringify({ error: 'Refused.' }), { status: 403 })
    renderIt()
    await pick('Spring Mentoring')()
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
