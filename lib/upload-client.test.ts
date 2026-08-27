import { describe, it, expect, vi, afterEach } from 'vitest'
import { MAX_UPLOAD_BYTES, MAX_DIRECT_UPLOAD_BYTES, readUploadBlob, postUpload, uploadDirectToStorage } from './upload-client'

const uploadToSignedUrl = vi.fn()
vi.mock('@/lib/supabase-browser', () => ({
  createStorageUploadClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
}))

function fileOf(bytes: number, name = 'doc.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
}

/** A picked file whose bytes can't be read — a Drive/iCloud placeholder. */
function unreadableFile(name = 'doc.pdf'): File {
  const file = fileOf(10, name)
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
  })
  return file
}

describe('readUploadBlob', () => {
  it('returns the bytes for a readable file', async () => {
    const result = await readUploadBlob(fileOf(1024))
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.blob.size).toBe(1024)
    expect(result.blob.type).toBe('application/pdf')
  })

  it('explains an unreadable file instead of failing mid-upload', async () => {
    const result = await readUploadBlob(unreadableFile('handbook.pdf'))
    expect(result).toEqual({ error: expect.stringContaining('Could not read') })
    if ('error' in result) expect(result.error).toContain('handbook.pdf')
  })

  it('treats a zero-byte read as unreadable', async () => {
    const result = await readUploadBlob(fileOf(0))
    expect(result).toEqual({ error: expect.stringContaining('Could not read') })
  })

  it('rejects a file over the platform request limit before posting', async () => {
    const result = await readUploadBlob(fileOf(MAX_UPLOAD_BYTES + 1))
    expect(result).toEqual({ error: expect.stringContaining('limited to') })
  })
})

describe('postUpload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"id":"abc"}', { status: 200 })))
    await expect(postUpload('/x', new FormData())).resolves.toEqual({ data: { id: 'abc' } })
  })

  it('surfaces the API error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Upload failed"}', { status: 500 })))
    await expect(postUpload('/x', new FormData())).resolves.toEqual({ error: 'Upload failed' })
  })

  it('does not report a non-JSON error page as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Payload Too Large</html>', { status: 413 })))
    const result = await postUpload('/x', new FormData())
    expect(result).toEqual({ error: expect.stringContaining('too large') })
  })

  it('reports a rejected fetch as a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const result = await postUpload('/x', new FormData())
    expect(result).toEqual({ error: expect.stringContaining('never reached the server') })
  })
})

describe('uploadDirectToStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    uploadToSignedUrl.mockReset()
  })

  const ticket = () =>
    new Response(JSON.stringify({ bucket: 'community-resources', path: 'resources/1-doc.pdf', token: 'tok' }), {
      status: 200,
    })

  it('sends a file past the 4.5MB function limit straight to storage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ticket())
    vi.stubGlobal('fetch', fetchMock)
    uploadToSignedUrl.mockResolvedValue({ error: null })

    // Larger than anything that could reach a route handler.
    const big = fileOf(6_851_819, 'handbook.pdf')
    const result = await uploadDirectToStorage(big)

    expect(result).toEqual({
      storagePath: 'resources/1-doc.pdf',
      fileName: 'handbook.pdf',
      fileType: 'application/pdf',
      fileSize: 6_851_819,
    })
    // Only the metadata crossed the function; the bytes went to storage.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/community/resources/upload-url')
    expect(uploadToSignedUrl).toHaveBeenCalledWith('resources/1-doc.pdf', 'tok', expect.anything(), expect.anything())
  })

  it('still refuses a file over the bucket-side ceiling', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await uploadDirectToStorage(fileOf(MAX_DIRECT_UPLOAD_BYTES + 1))
    expect(result).toEqual({ error: expect.stringContaining('limited to') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a storage-side rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ticket()))
    uploadToSignedUrl.mockResolvedValue({ error: { message: 'exceeded the maximum allowed size' } })
    const result = await uploadDirectToStorage(fileOf(1024))
    expect(result).toEqual({ error: expect.stringContaining('exceeded the maximum allowed size') })
  })

  it('surfaces a refused signed-URL request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Forbidden"}', { status: 403 })))
    const result = await uploadDirectToStorage(fileOf(1024))
    expect(result).toEqual({ error: 'Forbidden' })
    expect(uploadToSignedUrl).not.toHaveBeenCalled()
  })
})
