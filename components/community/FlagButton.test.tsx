import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FlagButton } from './FlagButton'

// The button says "Reported" only when the report was stored.

afterEach(() => vi.unstubAllGlobals())

async function report(response: Response | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (response instanceof Error) throw response
    return response
  }))
  render(<FlagButton contentType="post" contentId="p1" />)
  fireEvent.click(screen.getByTitle('Report this content'))
  fireEvent.click(screen.getByRole('button', { name: 'Report' }))
}

describe('FlagButton', () => {
  it('stored: says so', async () => {
    await report(Response.json({ ok: true }))
    expect(await screen.findByText('Reported')).toBeInTheDocument()
  })

  it.each([
    ['refused', Response.json({ error: 'Not found' }, { status: 404 })],
    ['offline', new Error('network')],
  ])('%s: says it was not sent, and leaves the form open', async (_name, response) => {
    await report(response)
    expect(await screen.findByRole('alert')).toHaveTextContent('send that report')
    expect(screen.queryByText('Reported')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Report' })).toBeEnabled())
  })
})
