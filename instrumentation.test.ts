// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

const { capture } = vi.hoisted(() => ({ capture: vi.fn(async () => {}) }))
vi.mock('./lib/app-errors', () => ({ captureRequestError: capture }))

import { onRequestError } from './instrumentation'

const request = { path: '/api/x', method: 'GET', headers: {} }
const context = { routerKind: 'App Router', routePath: '/api/x', routeType: 'route', revalidateReason: undefined } as const

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('instrumentation onRequestError', () => {
  it('hands Node-runtime errors to the recorder', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    const err = new Error('boom')
    await onRequestError(err, request, context)
    expect(capture).toHaveBeenCalledWith(err, request, context)
  })

  it('does nothing on the edge runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge')
    await onRequestError(new Error('boom'), request, context)
    expect(capture).not.toHaveBeenCalled()
  })

  it('never throws, even if the recorder does', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    capture.mockRejectedValueOnce(new Error('recorder broke'))
    await expect(onRequestError(new Error('boom'), request, context)).resolves.toBeUndefined()
  })
})
