// Design-system guardrail. Fails the build if the OLD brand regresses into UI
// code — pre-V2 hex literals or the old font-family names used directly in
// components. Tokens (design/tokens.json → tailwind) are the only source of
// brand values; see CLAUDE.md.
//
// Scope: app/** (excluding app/api — server/email/PDF code legitimately uses
// raw hex), components/**, packages/**. Generated files are never scanned.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'packages']
const SKIP = ['app/api', 'node_modules', '.next', 'storybook-static']
const EXT = /\.(ts|tsx|js|jsx)$/

// Pre-V2 brand palette — must never reappear in UI code.
const OLD_HEX = /#(0d439d|051535|1d5fd6|da6220|dda33b|c2410c|b67a1e|f4f1ea|e7e2d6|f0ece1|5b5648|8a8472|969696|374151)\b/gi
// Old font-family names — only valid in globals.css @font-face + tailwind config
// (the `font-competition` alias), never inline in components.
const OLD_FONT = /\b(Norwester|Aileron|Archivo Black|Fredoka)\b/g

function walk(dir, out = []) {
  if (SKIP.some((s) => dir === s || dir.startsWith(s + '/'))) return out
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e)
    if (SKIP.some((s) => p === s || p.startsWith(s + '/'))) continue
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXT.test(p)) out.push(p)
  }
  return out
}

const errors = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(OLD_HEX)) errors.push(`${file}: pre-V2 brand hex ${m[0]} — use a token utility instead`)
    for (const m of src.matchAll(OLD_FONT)) errors.push(`${file}: old font "${m[0]}" in UI code — use font-sans/font-display (or font-competition for materials)`)
  }
}

if (errors.length) {
  console.error(`\n✗ design-system lint: ${errors.length} violation(s)\n`)
  for (const e of errors) console.error('  ' + e)
  console.error('\nBrand values come from design/tokens.json via Tailwind tokens. See CLAUDE.md.\n')
  process.exit(1)
}
console.log('✓ design-system lint: no pre-V2 brand regressions')
