// Copies the barcode reader's WebAssembly file into public/, so the desk
// scanner loads it from our own site (and the desk's offline cache) instead of
// the package's default CDN. Runs before `dev` and `build`; the copy is
// gitignored, so it always matches the installed zxing-wasm version.
//
// Why a scanner at all: Safari ships no built-in barcode reader, so the check-in
// desk uses the barcode-detector polyfill (components/admin/CheckInScanner.tsx).

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const source = require.resolve('zxing-wasm/reader/zxing_reader.wasm')
const target = path.join(process.cwd(), 'public/vendor/zxing_reader.wasm')

if (!existsSync(source)) {
  console.error(`copy-scanner-wasm: ${source} is missing. Run npm install.`)
  process.exit(1)
}
mkdirSync(path.dirname(target), { recursive: true })
copyFileSync(source, target)
