import { crc32, deflateSync } from 'node:zlib'

/** A plain, fully transparent RGBA PNG of the given size, for tests. */
export function testPng(width = 120, height = 40): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8) // 8-bit RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height) // filter byte 0 on each row
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]))
}

export const pngDataUrl = (bytes: Uint8Array, type = 'image/png') => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
