import { constants, deflateRawSync } from 'node:zlib'

// Deflate bombs for the PDF scan and sandbox tests: a stream of zlib data that
// inflates to `header` and then a run of spaces, GBs from a few MB.
//
// Built from blocks, not by deflating GBs: one MB of spaces deflated once (a
// non-final block, flushed to a byte boundary) is repeated, then a final empty
// block and the Adler-32 of the whole are appended — valid zlib that a 4 GB
// bomb takes milliseconds to build.

const CHUNK = 1024 * 1024
const MOD = 65521

/** Adler-32 of `header` followed by `spaces` spaces. */
function adler32(header: Buffer, spaces: number): number {
  let a = 1
  let b = 0
  for (const byte of header) {
    a = (a + byte) % MOD
    b = (b + a) % MOD
  }
  // n more bytes of 0x20: a gains 32 each, and b gains n·a + 32·(1 + … + n)
  // = n·a + 16·n·(n + 1). Reduced as it goes: every product stays under 2^53.
  const n = spaces % MOD
  const n1 = (spaces + 1) % MOD
  b = (b + ((n * a) % MOD) + ((((n * n1) % MOD) * 16) % MOD)) % MOD
  a = (a + ((32 * n) % MOD)) % MOD
  return ((b << 16) | a) >>> 0
}

/** zlib data inflating to `header` then `spaces` spaces (rounded down to whole MB). */
export function deflateBomb(header: string, spaces: number): Buffer {
  const flush = { finishFlush: constants.Z_SYNC_FLUSH, level: 9 }
  const head = Buffer.from(header, 'latin1')
  const block = deflateRawSync(Buffer.alloc(CHUNK, 0x20), flush)
  const count = Math.floor(spaces / CHUNK)
  const check = Buffer.alloc(4)
  check.writeUInt32BE(adler32(head, count * CHUNK))
  return Buffer.concat([
    Buffer.from([0x78, 0xda]),
    deflateRawSync(head, flush),
    ...Array.from({ length: count }, () => block),
    deflateRawSync(Buffer.alloc(0)),
    check,
  ])
}

export const MB = 1024 * 1024
export const GB = 1024 * MB

/**
 * A one-page PDF with one stream object whose data is a bomb inflating to
 * `size` bytes behind a short, valid object-stream header (`5 0 << /A 1 >>`).
 * `dict` is the stream's dictionary, {L} the data's length; by default an
 * object stream, as the 4 GB file the verifier built (makebomb.cjs).
 */
export function bombPdf(size: number, dict = '<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length {L} >>'): Uint8Array {
  const data = deflateBomb('5 0 << /A 1 >>', size)
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(
        '%PDF-1.7\n' +
          '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
          '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
          '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n' +
          `4 0 obj\n${dict.replace('{L}', String(data.length))}\nstream\n`,
        'latin1',
      ),
      data,
      Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R /Size 6 >>\n%%EOF\n', 'latin1'),
    ]),
  )
}
