import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReactionBar } from './ReactionBar'

// The count moves straight away, and moves back if the server did not take it.

afterEach(() => vi.unstubAllGlobals())

function react(response: Response | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  }))
  render(<ReactionBar targetType="post" targetId="p1" initial={[{ emoji: '🎉', count: 2, reactedByMe: false }]} />)
  fireEvent.click(screen.getByRole('button', { name: /🎉/ }))
}

describe('ReactionBar', () => {
  it('accepted: the count stays', async () => {
    react(Response.json({ reacted: true }))
    expect(screen.getByRole('button', { name: /🎉/ })).toHaveTextContent('3')
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r))
    expect(screen.getByRole('button', { name: /🎉/ })).toHaveTextContent('3')
  })

  it.each([
    ['refused', Response.json({ error: 'Not found' }, { status: 404 })],
    ['offline', new Error('network')],
  ])('%s: the count goes back', async (_name, response) => {
    react(response)
    await waitFor(() => expect(screen.getByRole('button', { name: /🎉/ })).toHaveTextContent('2'))
  })
})
