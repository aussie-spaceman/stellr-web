import { describe, it, expect, vi, beforeEach } from 'vitest'

// Anyone can POST here, signed in or not, so a file name is capped before
// anything reads it: a megabyte of spaces once cost seconds of CPU in the
// extension check, ahead of any authorisation. signUpload is stubbed; the
// limit and message are the real ones.

const { signUpload, auth, supabaseServer, audit } = vi.hoisted(() => ({
  signUpload: vi.fn(),
  auth: vi.fn(),
  supabaseServer: vi.fn(),
  audit: {
    afters: [] as Array<() => Promise<unknown>>,
    rows: [] as Array<Record<string, unknown>>,
    fails: false,
    tenantHeaders: null as Record<string, string> | null,
  },
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => { audit.afters.push(task) },
}))
vi.mock('next/headers', () => ({
  headers: async () => {
    if (!audit.tenantHeaders) throw new Error('no request')
    return new Headers(audit.tenantHeaders)
  },
}))
vi.mock('@clerk/nextjs/server', () => ({ auth }))
vi.mock('@/lib/supabase', () => ({ supabaseServer }))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: async () => {} }))
vi.mock('@/lib/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/uploads')>()),
  signUpload,
}))

import { POST } from './route'
import { FILE_NAME_TOO_LONG, MAX_FILE_NAME_LENGTH } from '@/lib/uploads'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'
import { expectWithin } from '@/test/time-budget'

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
  auth.mockReset()
  auth.mockResolvedValue({ userId: 'user_2staff' })
  supabaseServer.mockReturnValue({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (audit.fails) throw new Error('audit write failed')
      audit.rows.push(args)
      return { data: { id: audit.rows.length, chain_seq: audit.rows.length }, error: null }
    },
  })
  audit.afters = []
  audit.rows = []
  audit.fails = false
  audit.tenantHeaders = null
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('TENANT_ROUTING_ENABLED', '')
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
      expectWithin(started, 500)
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

describe('POST /api/uploads/sign — platform audit', () => {
  const flush = async () => {
    for (const task of audit.afters.splice(0)) await task()
  }

  describe('with PLATFORM_AUDIT_ENABLED off, the default', () => {
    it('reads no session, schedules nothing and writes nothing', async () => {
      const res = await sign('a.pdf')
      expect(await res.json()).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
      expect(auth).not.toHaveBeenCalled()
      expect(audit.afters).toEqual([])
      expect(audit.rows).toEqual([])
    })

    it('does not count towards the audit cap', async () => {
      auth.mockResolvedValue({ userId: 'user_2flagoff' })
      for (let i = 0; i < 125; i++) await sign('a.pdf')
      vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true')
      await sign('a.pdf')
      await flush()
      expect(audit.rows[0].p_metadata).toEqual({ purpose: 'admin-resource' })
    })
  })

  describe('with it on', () => {
    beforeEach(() => vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true'))

    it('writes nothing until the response has been given', async () => {
      expect((await sign('a.pdf')).status).toBe(200)
      expect(audit.rows).toEqual([])
      expect(audit.afters).toHaveLength(1)
    })

    // auth() inside after() is unproven, so the actor is read before the response.
    // This mock stops answering once the response is in hand.
    it('reads the session before the response, not in the deferred write', async () => {
      await sign('a.pdf')
      expect(auth).toHaveBeenCalled()
      auth.mockRejectedValue(new Error('no session inside after()'))
      await flush()
      expect(audit.rows[0]).toMatchObject({ p_actor: 'user_2staff', p_actor_kind: 'user' })
    })

    it('caps one user\'s rows per purpose, marks the last one, and never limits the signing', async () => {
      auth.mockResolvedValue({ userId: 'user_2bulk' })
      for (let i = 0; i < 125; i++) expect((await sign('a.pdf')).status).toBe(200)
      expect(signUpload).toHaveBeenCalledTimes(125)
      await flush()
      expect(audit.rows).toHaveLength(121)
      expect(audit.rows[119].p_metadata).toEqual({ purpose: 'admin-resource' })
      expect(audit.rows[120].p_metadata).toEqual({ purpose: 'admin-resource', coalesced: true })
    })

    it('counts each user and each purpose apart', async () => {
      auth.mockResolvedValue({ userId: 'user_2bulkb' })
      for (let i = 0; i < 123; i++) await sign('a.pdf')
      await flush()
      audit.rows = []
      auth.mockResolvedValue({ userId: 'user_2other' })
      await sign('a.pdf')
      auth.mockResolvedValue({ userId: 'user_2bulkb' })
      await POST(
        new Request('http://x/api/uploads/sign', {
          method: 'POST',
          body: JSON.stringify({ purpose: 'community-media', fileName: 'a.png', fileSize: 10, contentType: 'image/png' }),
        }),
      )
      await flush()
      expect(audit.rows.map((r) => r.p_metadata)).toEqual([{ purpose: 'admin-resource' }, { purpose: 'community-media' }])
    })

    it('records the purpose, as the signed-in user, on the Stellr chain', async () => {
      await sign('a.pdf')
      await flush()
      expect(audit.rows).toEqual([expect.objectContaining({
        p_action: 'upload.sign.create',
        p_actor: 'user_2staff',
        p_actor_kind: 'user',
        p_tenant: STELLR_TENANT_ID,
        p_target_table: null,
        p_target_id: null,
        p_metadata: { purpose: 'admin-resource' },
      })])
    })

    it('keeps the file name, the path, the token and the context out of the row', async () => {
      signUpload.mockResolvedValue({ bucket: 'teacher-licenses', path: 'member-1/Jane-Doe-licence.pdf', token: 'secret-token' })
      await POST(
        new Request('http://x/api/uploads/sign', {
          method: 'POST',
          body: JSON.stringify({
            purpose: 'compliance-document',
            fileName: 'Jane-Doe-licence.pdf',
            fileSize: 10,
            contentType: 'application/pdf',
            context: { memberId: 'member-1', note: 'Jane' },
          }),
        }),
      )
      await flush()
      expect(audit.rows).toHaveLength(1)
      const row = JSON.stringify(audit.rows[0])
      for (const held of ['Jane', 'licence', 'member-1', 'secret-token']) expect(row).not.toContain(held)
    })

    it('records no event when signing is refused or fails: nothing was issued', async () => {
      signUpload.mockResolvedValueOnce({ error: 'Forbidden', status: 403 })
      expect((await sign('a.pdf')).status).toBe(403)
      signUpload.mockResolvedValueOnce({ error: 'Could not start the upload.', status: 500 })
      expect((await sign('a.pdf')).status).toBe(500)
      expect((await sign(42)).status).toBe(400)
      expect(audit.afters).toEqual([])
      expect(auth).not.toHaveBeenCalled()
    })

    it('a failed audit write changes nothing for the caller', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      audit.fails = true
      const res = await sign('a.pdf')
      expect(await res.json()).toEqual({ bucket: 'community-resources', path: 'p', token: 't' })
      await expect(flush()).resolves.toBeUndefined()
      expect(audit.rows).toEqual([])
      quiet.mockRestore()
    })

    it('a session that cannot be read fails nothing, and the row says so', async () => {
      auth.mockRejectedValue(new Error('clerk is down'))
      expect((await sign('a.pdf')).status).toBe(200)
      await flush()
      expect(audit.rows[0]).toMatchObject({ p_actor: 'system', p_metadata: { actor_unresolved: true } })
    })

    it('puts the event on the chain of the tenant the proxy named', async () => {
      const tenant = '22222222-2222-4222-8222-222222222222'
      vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
      audit.tenantHeaders = { [TENANT_ID_HEADER]: tenant, [TENANT_SLUG_HEADER]: 'acme' }
      await sign('a.pdf')
      await flush()
      expect(audit.rows[0].p_tenant).toBe(tenant)
    })

    it('never guesses a tenant it cannot read: the platform chain, marked, and the answer stands', async () => {
      vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
      expect((await sign('a.pdf')).status).toBe(200)
      await flush()
      expect(audit.rows[0]).toMatchObject({ p_tenant: null, p_metadata: { tenant_unresolved: true } })
    })
  })
})
