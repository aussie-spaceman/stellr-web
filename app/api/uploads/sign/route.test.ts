import { describe, it, expect, vi, beforeEach } from 'vitest'

// Anyone can POST here, signed in or not, so a file name is capped before
// anything reads it: a megabyte of spaces once cost seconds of CPU in the
// extension check, ahead of any authorisation. signUpload is stubbed; the
// limit and message are the real ones.

const { signUpload } = vi.hoisted(() => ({ signUpload: vi.fn() }))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads')>()),
  signUpload,
}))

import { POST } from './route'
import { FILE_NAME_TOO_LONG, MAX_FILE_NAME_LENGTH } from '@/lib/uploads'

const sign = (fileName: unknown) =>
  POST(
    new Request('http://x/api/uploads/sign', {
      method: 'POST',
      body: JSON.stringify({ purpose: 'admin-resource', fileName, fileSize: 10, contentType: 'application/pdf' }),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  signUpload.mockResolvedValue({ bucket: 'community-resources', path: 'p', token: 't' })
})

describe('POST /api/uploads/sign — file name length', () => {
  it('caps a name at 255 characters', () => {
    expect(MAX_FILE_NAME_LENGTH).toBe(255)
  })

  it('refuses a 256-character name with a 400, without calling signUpload', async () => {
    const res = await sign(`${'a'.repeat(252)}.pdf`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: FILE_NAME_TOO_LONG })
    expect(signUpload).not.toHaveBeenCalled()
  })

  it('passes a 255-character name on to signUpload', async () => {
    const name = `${'a'.repeat(251)}.pdf`
    const res = await sign(name)
    expect(res.status).toBe(200)
    expect(signUpload).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'admin-resource', fileName: name }))
  })

  it('measures the name after trimming it', async () => {
    const name = `${'a'.repeat(251)}.pdf`
    expect((await sign(`   ${name}   `)).status).toBe(200)
    expect(signUpload).toHaveBeenCalledWith(expect.objectContaining({ fileName: name }))
  })

  it('turns away a megabyte of spaces and dots at once', async () => {
    for (const run of [' ', '.']) {
      const started = performance.now()
      const res = await sign(`a${run.repeat(1024 * 1024)}x`)
      expect(res.status).toBe(400)
      expect(performance.now() - started).toBeLessThan(500)
    }
    expect(signUpload).not.toHaveBeenCalled()
  })

  it('still asks for a name', async () => {
    expect((await sign('   ')).status).toBe(400)
    expect((await sign(42)).status).toBe(400)
    expect(signUpload).not.toHaveBeenCalled()
  })
})

describe('POST /api/uploads/sign — purpose', () => {
  // `purpose in UPLOAD_PURPOSES` found what every object inherits, and signing
  // under 'toString' read no grant and threw: a 500 for anyone who asked.
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'refuses %j as an unknown purpose, without calling signUpload',
    async (purpose) => {
      const res = await POST(
        new Request('http://x/api/uploads/sign', {
          method: 'POST',
          body: JSON.stringify({ purpose, fileName: 'a.pdf', fileSize: 10, contentType: 'application/pdf' }),
        }),
      )
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Unknown upload purpose' })
      expect(signUpload).not.toHaveBeenCalled()
    },
  )

  it('still signs a purpose that is defined', async () => {
    expect((await sign('a.pdf')).status).toBe(200)
    expect(signUpload).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'admin-resource' }))
  })
})
