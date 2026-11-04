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

// ── Wall-clock budgets ──────────────────────────────────────────────────────
//
// A "linear time" test bounds growth, not speed. The scan reads 25 MB of the
// worst input in at most ~570 ms on a quiet laptop (~1.2 s on a CI runner); a
// quadratic pass over the same bytes takes tens of seconds to minutes. So the
// budget can be generous: it is multiplied by TIME_SCALE (5 on CI's slower,
// shared runners, 3 elsewhere), which still leaves an order of magnitude
// between a linear pass on a loaded machine and a super-linear one. Two CI
// runs at 1,026 ms and 1,169 ms against an unscaled 1,000 ms (Nov 2026), and a
// laptop with every core busy reaching 2.2 s, are why.
//
// Not for tests whose speed IS the property — a bomb refused before it
// inflates: those use REFUSAL_MS, unscaled.
export const TIME_SCALE = process.env.CI ? 5 : 3

/** A linear-time budget: `ms` on a quiet, fast machine, scaled for the runner. */
export const linearBudgetMs = (ms: number) => ms * TIME_SCALE

/**
 * Vitest's timeout for a test with a linear budget: past the budget, plus the
 * fixture it builds (seconds, for 2.5 million offsets), so a slow machine fails
 * on the budget's message, never on Vitest's default 5 s.
 */
export const LINEAR_TEST_TIMEOUT_MS = 30_000

/**
 * The bound on refusing a deflate bomb. The scan refuses one in ~5 ms (it stops
 * at LOAD_INFLATE_BUDGET); inflating the 4 GB bomb in full takes ~2.3 s on a
 * fast laptop and longer on CI. 1 s keeps 200× headroom over the refusal and
 * stays below the inflate — and far under the sandbox's 8 s worker timeout.
 */
export const REFUSAL_MS = 1_000

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
