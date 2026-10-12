// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review QUAL-1: runAfterResponse must register the task with after() so it
// survives the response flush, fall back to a detached run when there is no
// request context, and never let a task failure become an unhandled rejection.

const afterMock = vi.fn()
vi.mock('next/server', () => ({ after: (fn: () => unknown) => afterMock(fn) }))

const { runAfterResponse } = await import('./after-response')

beforeEach(() => {
  afterMock.mockReset()
  afterMock.mockImplementation((fn: () => unknown) => { void fn() })
})

describe('runAfterResponse', () => {
  it('registers the task with after() and runs it', async () => {
    let ran = false
    runAfterResponse('t', async () => { ran = true })
    expect(afterMock).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('still runs the task when after() throws (no request context)', async () => {
    afterMock.mockImplementation(() => { throw new Error('after() unavailable') })
    let ran = false
    runAfterResponse('t', async () => { ran = true })
    await Promise.resolve()
    expect(ran).toBe(true)
  })

  it('swallows and logs a task failure instead of throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => runAfterResponse('lbl', async () => { throw new Error('boom') })).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
